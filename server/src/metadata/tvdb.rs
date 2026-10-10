use std::time::{Duration, Instant};

use anyhow::{Context, bail};
use serde_json::{Value, json};
use tokio::sync::Mutex;

use super::EpisodeInfo;

const BASE: &str = "https://api4.thetvdb.com/v4";
// Tokens are valid for a month; refresh well before that.
const TOKEN_TTL: Duration = Duration::from_secs(7 * 24 * 3600);

struct Token {
    api_key: String,
    token: String,
    fetched: Instant,
}

pub struct Tvdb {
    http: reqwest::Client,
    token: Mutex<Option<Token>>,
}

impl Tvdb {
    pub fn new(http: reqwest::Client) -> Self {
        Self {
            http,
            token: Mutex::new(None),
        }
    }

    async fn token(&self, api_key: &str) -> anyhow::Result<String> {
        let mut guard = self.token.lock().await;
        if let Some(t) = guard.as_ref()
            && t.api_key == api_key
            && t.fetched.elapsed() < TOKEN_TTL
        {
            return Ok(t.token.clone());
        }
        let res = self
            .http
            .post(format!("{BASE}/login"))
            .json(&json!({ "apikey": api_key }))
            .send()
            .await
            .context("contacting TVDB")?;
        if !res.status().is_success() {
            bail!("TVDB login failed ({})", res.status());
        }
        let body: Value = res.json().await?;
        let token = body["data"]["token"]
            .as_str()
            .context("TVDB login response had no token")?
            .to_string();
        *guard = Some(Token {
            api_key: api_key.to_string(),
            token: token.clone(),
            fetched: Instant::now(),
        });
        Ok(token)
    }

    async fn get(&self, api_key: &str, path: &str) -> anyhow::Result<Value> {
        let token = self.token(api_key).await?;
        let res = self
            .http
            .get(format!("{BASE}{path}"))
            .bearer_auth(token)
            .send()
            .await
            .context("contacting TVDB")?;
        if res.status() == reqwest::StatusCode::UNAUTHORIZED {
            *self.token.lock().await = None;
            bail!("TVDB rejected the token");
        }
        if !res.status().is_success() {
            bail!("TVDB returned {}", res.status());
        }
        Ok(res.json().await?)
    }

    pub async fn validate_key(&self, api_key: &str) -> anyhow::Result<()> {
        *self.token.lock().await = None;
        self.token(api_key).await.map(|_| ())
    }

    /// All episodes of a series in the default (aired) order.
    pub async fn episodes(&self, api_key: &str, series_id: i64) -> anyhow::Result<Vec<EpisodeInfo>> {
        let mut out = Vec::new();
        for page in 0..20 {
            let body = self
                .get(api_key, &format!("/series/{series_id}/episodes/default?page={page}"))
                .await?;
            let eps = body["data"]["episodes"].as_array().cloned().unwrap_or_default();
            if eps.is_empty() {
                break;
            }
            for e in eps {
                let (Some(season), Some(number)) = (e["seasonNumber"].as_i64(), e["number"].as_i64())
                else {
                    continue;
                };
                out.push(EpisodeInfo {
                    season_number: season,
                    episode_number: number,
                    absolute_number: e["absoluteNumber"].as_i64().filter(|n| *n > 0),
                    name: e["name"].as_str().map(String::from),
                    overview: e["overview"].as_str().map(String::from),
                    still_path: e["image"].as_str().filter(|s| !s.is_empty()).map(String::from),
                    air_date: e["aired"].as_str().map(String::from),
                    runtime: e["runtime"].as_i64(),
                    rating: None,
                    tmdb_id: None,
                    tvdb_id: e["id"].as_i64(),
                });
            }
            if body["links"]["next"].is_null() {
                break;
            }
        }
        Ok(out)
    }
}
