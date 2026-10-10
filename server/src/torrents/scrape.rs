//! Tracker scrapes: ask trackers how many seeders and leechers a torrent has
//! without joining the swarm. Supports HTTP(S) trackers and UDP trackers
//! (BEP 15).

use std::{collections::BTreeMap, net::SocketAddr, time::Duration};

use serde::Serialize;
use tokio::net::UdpSocket;

use super::engine::NetConfig;

const TIMEOUT: Duration = Duration::from_secs(8);
const MAX_TRACKERS: usize = 12;

#[derive(Debug, Clone, Serialize)]
pub struct SwarmStats {
    pub seeders: u64,
    pub leechers: u64,
    pub completed: Option<u64>,
    /// How many trackers answered.
    pub trackers_answered: usize,
    pub trackers_tried: usize,
    /// Why trackers weren't asked at all.
    pub skipped: Option<String>,
}

/// How scrapes leave the machine: the same way torrent traffic does.
#[derive(Clone)]
struct Route {
    http: reqwest::Client,
    /// None: UDP isn't allowed. Some(None): any interface.
    udp: Option<Option<String>>,
}

#[derive(Debug, Clone, Copy)]
struct Scrape {
    seeders: u64,
    leechers: u64,
    completed: Option<u64>,
}

/// Scrape up to a dozen trackers at once and keep the best answer. Trackers
/// rarely agree, and the biggest number is the closest to the real swarm.
pub async fn scrape(trackers: &[String], info_hash: &str, net: &NetConfig) -> Option<SwarmStats> {
    let hash: [u8; 20] = hex::decode(info_hash).ok()?.try_into().ok()?;
    let skipped = |reason: &str| {
        Some(SwarmStats {
            seeders: 0,
            leechers: 0,
            completed: None,
            trackers_answered: 0,
            trackers_tried: 0,
            skipped: Some(reason.to_string()),
        })
    };
    let Some(http) = crate::network::http_client(net, TIMEOUT) else {
        return skipped("torrent traffic is switched off");
    };
    let route = Route {
        http,
        udp: match net {
            NetConfig::Direct => Some(None),
            NetConfig::Interface { name } => Some(Some(name.clone())),
            NetConfig::Socks5 { .. } | NetConfig::Off { .. } => None,
        },
    };
    let mut list: Vec<String> = Vec::new();
    for t in trackers {
        let usable = t.starts_with("http") || (t.starts_with("udp://") && route.udp.is_some());
        if !list.contains(t) && usable {
            list.push(t.clone());
        }
    }
    list.truncate(MAX_TRACKERS);
    let tried = list.len();
    if tried == 0 {
        return None;
    }

    let tasks = list.into_iter().map(|t| {
        let route = route.clone();
        tokio::spawn(async move {
            match tokio::time::timeout(TIMEOUT, scrape_one(&t, &hash, &route)).await {
                Ok(Ok(s)) => Some(s),
                Ok(Err(e)) => {
                    tracing::debug!(tracker = %t, error = %e, "scrape failed");
                    None
                }
                Err(_) => None,
            }
        })
    });
    let results: Vec<Scrape> = futures::future::join_all(tasks)
        .await
        .into_iter()
        .filter_map(|r| r.ok().flatten())
        .collect();

    if results.is_empty() {
        return Some(SwarmStats {
            seeders: 0,
            leechers: 0,
            completed: None,
            trackers_answered: 0,
            trackers_tried: tried,
            skipped: None,
        });
    }
    Some(SwarmStats {
        seeders: results.iter().map(|r| r.seeders).max().unwrap_or(0),
        leechers: results.iter().map(|r| r.leechers).max().unwrap_or(0),
        completed: results.iter().filter_map(|r| r.completed).max(),
        trackers_answered: results.len(),
        trackers_tried: tried,
        skipped: None,
    })
}

async fn scrape_one(tracker: &str, hash: &[u8; 20], route: &Route) -> anyhow::Result<Scrape> {
    if tracker.starts_with("udp://") {
        match &route.udp {
            Some(iface) => udp_scrape(tracker, hash, iface.as_deref()).await,
            None => anyhow::bail!("UDP isn't allowed on this route"),
        }
    } else {
        http_scrape(tracker, hash, &route.http).await
    }
}

/// `.../announce` becomes `.../scrape`, as the convention goes. Trackers
/// whose path doesn't follow it don't support scraping.
fn scrape_url(announce: &str) -> Option<String> {
    let (base, query) = match announce.split_once('?') {
        Some((b, q)) => (b, Some(q)),
        None => (announce, None),
    };
    let slash = base.rfind('/')?;
    let last = &base[slash + 1..];
    if !last.starts_with("announce") {
        return None;
    }
    let mut url = format!("{}/scrape{}", &base[..slash], &last["announce".len()..]);
    if let Some(q) = query {
        url.push('?');
        url.push_str(q);
    }
    Some(url)
}

async fn http_scrape(tracker: &str, hash: &[u8; 20], http: &reqwest::Client) -> anyhow::Result<Scrape> {
    let url = scrape_url(tracker).ok_or_else(|| anyhow::anyhow!("tracker doesn't support scrape"))?;
    let sep = if url.contains('?') { '&' } else { '?' };
    let encoded: String = hash.iter().map(|b| format!("%{b:02X}")).collect();
    let body = http
        .get(format!("{url}{sep}info_hash={encoded}"))
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;

    let (value, _) = Bencode::parse(&body).ok_or_else(|| anyhow::anyhow!("invalid scrape response"))?;
    let files = value.get(b"files").ok_or_else(|| anyhow::anyhow!("no files in scrape response"))?;
    let entry = match files {
        Bencode::Dict(d) => d
            .get(hash.as_slice())
            .or_else(|| d.values().next())
            .ok_or_else(|| anyhow::anyhow!("torrent unknown to tracker"))?,
        _ => anyhow::bail!("invalid scrape response"),
    };
    Ok(Scrape {
        seeders: entry.get(b"complete").and_then(Bencode::int).unwrap_or(0),
        leechers: entry.get(b"incomplete").and_then(Bencode::int).unwrap_or(0),
        completed: entry.get(b"downloaded").and_then(Bencode::int),
    })
}

async fn udp_scrape(tracker: &str, hash: &[u8; 20], iface: Option<&str>) -> anyhow::Result<Scrape> {
    let url = url::Url::parse(tracker)?;
    let host = url.host_str().ok_or_else(|| anyhow::anyhow!("no host"))?;
    let port = url.port().ok_or_else(|| anyhow::anyhow!("no port"))?;
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host, port)).await?.collect();
    // Prefer IPv4; plenty of hosts have no IPv6 route.
    let addr = addrs
        .iter()
        .find(|a| a.is_ipv4())
        .or(addrs.first())
        .copied()
        .ok_or_else(|| anyhow::anyhow!("could not resolve tracker"))?;
    let bind: SocketAddr = if addr.is_ipv4() { "0.0.0.0:0" } else { "[::]:0" }.parse()?;
    let socket = UdpSocket::bind(bind).await?;
    if let Some(name) = iface
        && !crate::network::bind_udp_to_interface(&socket, name)
    {
        anyhow::bail!("couldn't bind to {name}");
    }
    socket.connect(addr).await?;

    let tx: u32 = rand::random();
    let mut req = Vec::with_capacity(16);
    req.extend_from_slice(&0x41727101980u64.to_be_bytes());
    req.extend_from_slice(&0u32.to_be_bytes());
    req.extend_from_slice(&tx.to_be_bytes());
    let res = udp_roundtrip(&socket, &req, 16).await?;
    if u32::from_be_bytes(res[0..4].try_into()?) != 0 || u32::from_be_bytes(res[4..8].try_into()?) != tx {
        anyhow::bail!("bad connect response");
    }
    let connection_id = &res[8..16];

    let tx: u32 = rand::random();
    let mut req = Vec::with_capacity(36);
    req.extend_from_slice(connection_id);
    req.extend_from_slice(&2u32.to_be_bytes());
    req.extend_from_slice(&tx.to_be_bytes());
    req.extend_from_slice(hash);
    let res = udp_roundtrip(&socket, &req, 20).await?;
    if u32::from_be_bytes(res[0..4].try_into()?) != 2 || u32::from_be_bytes(res[4..8].try_into()?) != tx {
        anyhow::bail!("bad scrape response");
    }
    let n = |i: usize| u32::from_be_bytes(res[i..i + 4].try_into().unwrap()) as u64;
    Ok(Scrape {
        seeders: n(8),
        completed: Some(n(12)),
        leechers: n(16),
    })
}

/// UDP is lossy, so retry a couple of times before giving up.
async fn udp_roundtrip(socket: &UdpSocket, req: &[u8], min_len: usize) -> anyhow::Result<Vec<u8>> {
    let mut buf = vec![0u8; 1500];
    for _ in 0..3 {
        socket.send(req).await?;
        if let Ok(Ok(n)) = tokio::time::timeout(Duration::from_secs(2), socket.recv(&mut buf)).await
            && n >= min_len
        {
            buf.truncate(n);
            return Ok(buf);
        }
    }
    anyhow::bail!("no answer")
}

/// Just enough bencode to read scrape responses.
#[derive(Debug)]
#[allow(dead_code)]
enum Bencode {
    Int(i64),
    Bytes(Vec<u8>),
    List(Vec<Bencode>),
    Dict(BTreeMap<Vec<u8>, Bencode>),
}

impl Bencode {
    fn parse(b: &[u8]) -> Option<(Bencode, &[u8])> {
        match *b.first()? {
            b'i' => {
                let end = b.iter().position(|&c| c == b'e')?;
                let n = std::str::from_utf8(&b[1..end]).ok()?.parse().ok()?;
                Some((Bencode::Int(n), &b[end + 1..]))
            }
            b'l' => {
                let mut rest = &b[1..];
                let mut items = Vec::new();
                while *rest.first()? != b'e' {
                    let (v, r) = Bencode::parse(rest)?;
                    items.push(v);
                    rest = r;
                }
                Some((Bencode::List(items), &rest[1..]))
            }
            b'd' => {
                let mut rest = &b[1..];
                let mut map = BTreeMap::new();
                while *rest.first()? != b'e' {
                    let (Bencode::Bytes(k), r) = Bencode::parse(rest)? else { return None };
                    let (v, r) = Bencode::parse(r)?;
                    map.insert(k, v);
                    rest = r;
                }
                Some((Bencode::Dict(map), &rest[1..]))
            }
            b'0'..=b'9' => {
                let colon = b.iter().position(|&c| c == b':')?;
                let len: usize = std::str::from_utf8(&b[..colon]).ok()?.parse().ok()?;
                let start = colon + 1;
                let data = b.get(start..start + len)?.to_vec();
                Some((Bencode::Bytes(data), &b[start + len..]))
            }
            _ => None,
        }
    }

    fn get(&self, key: &[u8]) -> Option<&Bencode> {
        match self {
            Bencode::Dict(d) => d.get(key),
            _ => None,
        }
    }

    fn int(&self) -> Option<u64> {
        match self {
            Bencode::Int(n) => u64::try_from(*n).ok(),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrape_urls() {
        assert_eq!(
            scrape_url("http://t.example/announce").as_deref(),
            Some("http://t.example/scrape")
        );
        assert_eq!(
            scrape_url("https://t.example/x/announce.php?passkey=1").as_deref(),
            Some("https://t.example/x/scrape.php?passkey=1")
        );
        assert_eq!(scrape_url("http://t.example/a"), None);
    }

    #[test]
    fn parses_scrape_response() {
        let mut body = b"d5:filesd20:".to_vec();
        body.extend_from_slice(&[7u8; 20]);
        body.extend_from_slice(b"d8:completei12e10:downloadedi300e10:incompletei4eeee");
        let (v, rest) = Bencode::parse(&body).unwrap();
        assert!(rest.is_empty());
        let entry = v.get(b"files").unwrap().get(&[7u8; 20]).unwrap();
        assert_eq!(entry.get(b"complete").and_then(Bencode::int), Some(12));
        assert_eq!(entry.get(b"incomplete").and_then(Bencode::int), Some(4));
    }
}
