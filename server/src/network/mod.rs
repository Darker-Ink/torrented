//! Where torrent traffic goes: straight out, through a VPN, or nowhere.
//!
//! The admin picks a VPN mode in the settings. Whatever it is, the torrent
//! session only starts once the VPN is usable; otherwise it stays off (a
//! kill switch) and streams can still come from a seedbox.

pub mod wireguard;

use std::time::Duration;

use serde::Serialize;

use crate::{settings::Settings, state::AppState, torrents::engine::NetConfig};

/// Work out the torrent network from the saved settings, bringing up a
/// WireGuard tunnel first if that's what's configured.
pub async fn config_from_settings(settings: &Settings, data_dir: &std::path::Path) -> NetConfig {
    if settings.get("seedbox_provider").await != "off"
        && settings.get("seedbox_mode").await == "only"
        && !settings.get("seedbox_api_key").await.is_empty()
    {
        wireguard::down().await;
        return NetConfig::Off {
            reason: "seedbox only mode: no peer-to-peer connections are made".into(),
        };
    }
    let mode = settings.get("vpn_mode").await;
    if mode != "wireguard" {
        wireguard::down().await;
    }
    match mode.as_str() {
        "socks5" => {
            let host = settings.get("vpn_socks5_host").await;
            let port = settings.get("vpn_socks5_port").await;
            if host.trim().is_empty() {
                return NetConfig::Off { reason: "the VPN proxy has no host set".into() };
            }
            let user = settings.get("vpn_socks5_username").await;
            let pass = settings.get("vpn_socks5_password").await;
            let auth = if user.is_empty() {
                String::new()
            } else {
                format!("{}:{}@", urlencoding::encode(&user), urlencoding::encode(&pass))
            };
            let port: u16 = port.trim().parse().unwrap_or(1080);
            NetConfig::Socks5 { url: format!("socks5://{auth}{}:{port}", host.trim()) }
        }
        "interface" => {
            let name = settings.get("vpn_interface").await;
            if name.trim().is_empty() {
                return NetConfig::Off { reason: "no VPN interface set".into() };
            }
            NetConfig::Interface { name: name.trim().to_string() }
        }
        "wireguard" => {
            let conf = settings.get("vpn_wireguard_config").await;
            if conf.trim().is_empty() {
                return NetConfig::Off { reason: "no WireGuard config set".into() };
            }
            match wireguard::up(&conf, data_dir).await {
                Ok(name) => NetConfig::Interface { name },
                Err(e) => NetConfig::Off { reason: format!("WireGuard didn't come up: {e:#}") },
            }
        }
        _ => NetConfig::Direct,
    }
}

/// Re-read the settings and restart the torrent session with them.
pub async fn apply(state: &AppState) {
    let net = config_from_settings(&state.settings, &state.config.data_dir).await;
    state.engine.reconfigure(net).await;
}

/// An HTTP client that goes out the same way torrent traffic does, or
/// `None` when torrent traffic is switched off.
pub fn http_client(net: &NetConfig, timeout: Duration) -> Option<reqwest::Client> {
    let builder = reqwest::Client::builder()
        .timeout(timeout)
        .user_agent(concat!("torrented/", env!("CARGO_PKG_VERSION")));
    let builder = match net {
        NetConfig::Direct => builder,
        NetConfig::Socks5 { url } => builder.proxy(reqwest::Proxy::all(url).ok()?),
        NetConfig::Interface { name } => bind_interface(builder, name)?,
        NetConfig::Off { .. } => return None,
    };
    builder.build().ok()
}

#[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
fn bind_interface(b: reqwest::ClientBuilder, name: &str) -> Option<reqwest::ClientBuilder> {
    Some(b.interface(name))
}

#[cfg(not(any(target_os = "linux", target_os = "android", target_os = "macos")))]
fn bind_interface(_b: reqwest::ClientBuilder, _name: &str) -> Option<reqwest::ClientBuilder> {
    None
}

/// Bind a UDP socket to an interface (Linux). Returns false where that isn't
/// possible, in which case the caller must not send anything.
pub fn bind_udp_to_interface(socket: &tokio::net::UdpSocket, name: &str) -> bool {
    #[cfg(target_os = "linux")]
    {
        use std::os::fd::AsRawFd;
        let fd = socket.as_raw_fd();
        // SAFETY: setsockopt reads `name.len()` bytes from a valid pointer.
        let rc = unsafe {
            libc::setsockopt(
                fd,
                libc::SOL_SOCKET,
                libc::SO_BINDTODEVICE,
                name.as_ptr().cast(),
                name.len() as libc::socklen_t,
            )
        };
        rc == 0
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (socket, name);
        false
    }
}

#[derive(Debug, Serialize)]
pub struct IpCheck {
    /// Public address torrent traffic appears to come from.
    pub torrent_ip: Option<String>,
    /// Public address of the server itself.
    pub server_ip: Option<String>,
    pub error: Option<String>,
}

async fn public_ip(client: &reqwest::Client) -> anyhow::Result<String> {
    let ip = client
        .get("https://api.ipify.org")
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    Ok(ip.trim().to_string())
}

/// Compare the address peers see with the server's own, to confirm the VPN
/// is doing its job.
pub async fn check_ip(net: &NetConfig) -> IpCheck {
    let timeout = Duration::from_secs(15);
    let direct = reqwest::Client::builder().timeout(timeout).build().ok();
    let server_ip = match &direct {
        Some(c) => public_ip(c).await.ok(),
        None => None,
    };
    let (torrent_ip, error) = match http_client(net, timeout) {
        None => (None, Some("torrent traffic is switched off".to_string())),
        Some(c) => match public_ip(&c).await {
            Ok(ip) => (Some(ip), None),
            Err(e) => (None, Some(format!("{e:#}"))),
        },
    };
    IpCheck { torrent_ip, server_ip, error }
}
