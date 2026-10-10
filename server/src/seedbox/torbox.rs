//! TorBox (torbox.app) API client.
//!
//! TorBox downloads torrents on its own servers (instantly when they're
//! already cached there) and serves each file over HTTPS with range
//! support, so playback never touches the swarm from this machine.

use std::time::Duration;

use anyhow::{Context, bail};
use bytes::Bytes;
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
pub struct Torrent {
    pub id: i64,
    #[serde(default)]
    pub hash: String,
    #[serde(default)]
    pub download_state: String,
    #[serde(default)]
    pub download_finished: bool,
    #[serde(default)]
    pub download_present: bool,
    #[serde(default)]
    pub progress: f64,
    #[serde(default)]
    pub files: Vec<File>,
}

impl Torrent {
    pub fn ready(&self) -> bool {
        self.download_present || self.download_finished
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct File {
    pub id: i64,
    /// Path including the torrent's folder.
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub short_name: String,
    #[serde(default)]
    pub size: u64,
}

#[derive(Deserialize)]
struct Envelope<T> {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    detail: Option<String>,
    data: Option<T>,
}

#[derive(Clone)]
pub struct TorBox {
    http: reqwest::Client,
    base: String,
}

impl TorBox {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .user_agent(concat!("torrented/", env!("CARGO_PKG_VERSION")))
                .build()
                .expect("building HTTP client"),
            // Overridable for testing against a stand-in.
            base: std::env::var("TORRENTED_TORBOX_API_URL")
                .unwrap_or_else(|_| "https://api.torbox.app".into())
                .trim_end_matches('/')
                .to_string(),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}/v1/api{path}", self.base)
    }

    async fn parse<T: DeserializeOwned>(res: reqwest::Response) -> anyhow::Result<T> {
        let status = res.status();
        let body = res.bytes().await?;
        let env: Envelope<T> = serde_json::from_slice(&body).with_context(|| {
            format!("unexpected TorBox response (HTTP {status}): {}", String::from_utf8_lossy(&body[..body.len().min(200)]))
        })?;
        if !env.success || !status.is_success() {
            bail!(
                "TorBox: {}",
                env.detail.or(env.error).unwrap_or_else(|| format!("HTTP {status}"))
            );
        }
        env.data.context("TorBox returned no data")
    }

    /// The account the key belongs to.
    pub async fn me(&self, key: &str) -> anyhow::Result<Value> {
        let res = self.http.get(self.url("/user/me")).bearer_auth(key).send().await?;
        Self::parse(res).await
    }

    /// Every torrent in the account.
    pub async fn list(&self, key: &str) -> anyhow::Result<Vec<Torrent>> {
        let mut out = Vec::new();
        let limit = 1000;
        loop {
            let res = self
                .http
                .get(self.url("/torrents/mylist"))
                .bearer_auth(key)
                .query(&[("bypass_cache", "true"), ("offset", &out.len().to_string()), ("limit", &limit.to_string())])
                .send()
                .await?;
            let page: Vec<Torrent> = Self::parse(res).await?;
            let n = page.len();
            out.extend(page);
            if n < limit {
                break;
            }
        }
        Ok(out)
    }

    /// Add a torrent without seeding it. Returns its id once TorBox has
    /// accepted it (queued torrents have no id yet).
    pub async fn add(&self, key: &str, magnet: Option<&str>, file: Option<Bytes>) -> anyhow::Result<Option<i64>> {
        let mut form = reqwest::multipart::Form::new()
            // 3: never seed.
            .text("seed", "3")
            .text("allow_zip", "false");
        match (file, magnet) {
            (Some(bytes), _) => {
                form = form.part(
                    "file",
                    reqwest::multipart::Part::bytes(bytes.to_vec())
                        .file_name("torrent.torrent")
                        .mime_str("application/x-bittorrent")?,
                );
            }
            (None, Some(m)) => form = form.text("magnet", m.to_string()),
            (None, None) => bail!("nothing to add"),
        }
        let res = self
            .http
            .post(self.url("/torrents/createtorrent"))
            .bearer_auth(key)
            .multipart(form)
            .send()
            .await?;
        let data: Value = Self::parse(res).await?;
        Ok(data.get("torrent_id").and_then(Value::as_i64))
    }

    /// Whether TorBox already has this torrent, so adding it is instant.
    pub async fn is_cached(&self, key: &str, info_hash: &str) -> anyhow::Result<bool> {
        let res = self
            .http
            .get(self.url("/torrents/checkcached"))
            .bearer_auth(key)
            .query(&[("hash", info_hash), ("format", "object"), ("list_files", "false")])
            .send()
            .await?;
        let data: Option<Value> = Self::parse::<Value>(res).await.ok();
        Ok(match data {
            Some(Value::Object(m)) => !m.is_empty(),
            Some(Value::Array(a)) => !a.is_empty(),
            _ => false,
        })
    }

    /// A short-lived HTTPS link for one file, which supports range requests.
    pub async fn download_link(&self, key: &str, torrent_id: i64, file_id: i64) -> anyhow::Result<String> {
        let res = self
            .http
            .get(self.url("/torrents/requestdl"))
            .query(&[
                ("token", key),
                ("torrent_id", &torrent_id.to_string()),
                ("file_id", &file_id.to_string()),
                ("zip_link", "false"),
            ])
            .send()
            .await?;
        Self::parse(res).await
    }

    /// The .torrent file, once TorBox has the metadata.
    pub async fn export_torrent(&self, key: &str, torrent_id: i64) -> anyhow::Result<Bytes> {
        let res = self
            .http
            .get(self.url("/torrents/exportdata"))
            .bearer_auth(key)
            .query(&[("torrent_id", torrent_id.to_string().as_str()), ("type", "file")])
            .send()
            .await?;
        let is_json = res
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| v.contains("json"));
        if is_json || !res.status().is_success() {
            let v: Value = Self::parse(res).await?;
            bail!("TorBox didn't return a torrent file: {v}");
        }
        Ok(res.bytes().await?)
    }
}
