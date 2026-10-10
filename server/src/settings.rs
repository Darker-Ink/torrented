//! Instance settings, persisted in `main.db` and cached in memory.

use std::collections::HashMap;

use serde::Serialize;
use sqlx::SqlitePool;
use tokio::sync::RwLock;

use crate::{
    auth::permissions::perm,
    config::{Config, DEFAULT_TMDB_API_KEY, DEFAULT_TVDB_API_KEY},
};

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SettingKind {
    String,
    Secret,
    Number,
    Bool,
    Select,
}

#[derive(Debug, Serialize)]
pub struct SettingDef {
    pub key: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub kind: SettingKind,
    pub default: &'static str,
    #[serde(skip_serializing_if = "<[_]>::is_empty")]
    pub options: &'static [&'static str],
    pub group: &'static str,
}

pub const DEFS: &[SettingDef] = &[
    SettingDef {
        key: "instance_name",
        label: "Instance name",
        description: "Shown in the header and on the sign-in page.",
        kind: SettingKind::String,
        default: "torrented",
        options: &[],
        group: "General",
    },
    SettingDef {
        key: "registration_mode",
        label: "Registration",
        description: "Who can create an account: anyone, invited users only, or nobody.",
        kind: SettingKind::Select,
        default: "invite",
        options: &["open", "invite", "closed"],
        group: "General",
    },
    SettingDef {
        key: "default_permissions",
        label: "Default permissions",
        description: "Permission bits given to newly registered users.",
        kind: SettingKind::Number,
        default: "3",
        options: &[],
        group: "General",
    },
    SettingDef {
        key: "tmdb_api_key",
        label: "TMDB API key",
        description: "v3 API key from themoviedb.org. Leave empty to use the built-in key.",
        kind: SettingKind::Secret,
        default: "",
        options: &[],
        group: "Metadata",
    },
    SettingDef {
        key: "tvdb_api_key",
        label: "TVDB API key",
        description: "v4 API key from thetvdb.com. Leave empty to use the built-in key.",
        kind: SettingKind::Secret,
        default: "",
        options: &[],
        group: "Metadata",
    },
    SettingDef {
        key: "metadata_language",
        label: "Metadata language",
        description: "Language used for titles and overviews, e.g. en-US or de-DE.",
        kind: SettingKind::String,
        default: "en-US",
        options: &[],
        group: "Metadata",
    },
    SettingDef {
        key: "cache_max_gb",
        label: "Stream cache size (GB)",
        description: "Upper bound for pieces kept on disk while streaming. Idle torrents are evicted first.",
        kind: SettingKind::Number,
        default: "20",
        options: &[],
        group: "Streaming",
    },
    SettingDef {
        key: "readahead_mb",
        label: "Read-ahead buffer (MB)",
        description: "How far past the playhead pieces are fetched. Nothing beyond this is downloaded, not even the rest of the episode.",
        kind: SettingKind::Number,
        default: "256",
        options: &[],
        group: "Streaming",
    },
    SettingDef {
        key: "idle_timeout_minutes",
        label: "Idle timeout (minutes)",
        description: "Stop a torrent and drop its cached pieces after nobody has streamed it for this long.",
        kind: SettingKind::Number,
        default: "10",
        options: &[],
        group: "Streaming",
    },
    SettingDef {
        key: "transcode_mode",
        label: "Playback compatibility",
        description: "auto: remux or transcode files browsers cannot play. off: always play the original file.",
        kind: SettingKind::Select,
        default: "auto",
        options: &["auto", "off"],
        group: "Streaming",
    },
    SettingDef {
        key: "vpn_mode",
        label: "VPN",
        description: "How torrent traffic leaves this server. If the VPN isn't available, nothing is sent at all.",
        kind: SettingKind::Select,
        default: "off",
        options: &["off", "socks5", "interface", "wireguard"],
        group: "VPN",
    },
    SettingDef {
        key: "vpn_socks5_host",
        label: "Proxy host",
        description: "SOCKS5 proxy from your VPN provider, e.g. 10.64.0.1 or proxy.example.com.",
        kind: SettingKind::String,
        default: "",
        options: &[],
        group: "VPN",
    },
    SettingDef {
        key: "vpn_socks5_port",
        label: "Proxy port",
        description: "Usually 1080.",
        kind: SettingKind::Number,
        default: "1080",
        options: &[],
        group: "VPN",
    },
    SettingDef {
        key: "vpn_socks5_username",
        label: "Proxy username",
        description: "Leave empty if the proxy needs no login.",
        kind: SettingKind::String,
        default: "",
        options: &[],
        group: "VPN",
    },
    SettingDef {
        key: "vpn_socks5_password",
        label: "Proxy password",
        description: "",
        kind: SettingKind::Secret,
        default: "",
        options: &[],
        group: "VPN",
    },
    SettingDef {
        key: "vpn_interface",
        label: "Network interface",
        description: "A tunnel that is already up on this machine, e.g. wg0 or tun0.",
        kind: SettingKind::String,
        default: "",
        options: &[],
        group: "VPN",
    },
    SettingDef {
        key: "vpn_wireguard_config",
        label: "WireGuard config",
        description: "The .conf file from your VPN provider. Linux only; needs the NET_ADMIN capability.",
        kind: SettingKind::Secret,
        default: "",
        options: &[],
        group: "VPN",
    },
    SettingDef {
        key: "seedbox_provider",
        label: "Seedbox",
        description: "Fetch torrents through a seedbox service and stream over HTTPS.",
        kind: SettingKind::Select,
        default: "off",
        options: &["off", "torbox"],
        group: "Seedbox",
    },
    SettingDef {
        key: "seedbox_api_key",
        label: "API key",
        description: "From your TorBox account settings.",
        kind: SettingKind::Secret,
        default: "",
        options: &[],
        group: "Seedbox",
    },
    SettingDef {
        key: "seedbox_mode",
        label: "Mode",
        description: "prefer: stream from the seedbox when it has the files, otherwise from peers. only: never connect to peers.",
        kind: SettingKind::Select,
        default: "prefer",
        options: &["prefer", "only"],
        group: "Seedbox",
    },
    SettingDef {
        key: "seedbox_add_on_import",
        label: "Send new torrents to the seedbox",
        description: "Add torrents to the seedbox as soon as they're attached to a title, so they're ready before anyone presses play.",
        kind: SettingKind::Bool,
        default: "true",
        options: &[],
        group: "Seedbox",
    },
    SettingDef {
        key: "probe_on_add",
        label: "Probe files after adding",
        description: "Partially download each video file's headers with ffprobe to confirm codecs and duration.",
        kind: SettingKind::Bool,
        default: "true",
        options: &[],
        group: "Streaming",
    },
];

pub struct Settings {
    pool: SqlitePool,
    cache: RwLock<HashMap<String, String>>,
    env_tmdb: Option<String>,
    env_tvdb: Option<String>,
}

impl Settings {
    pub async fn load(pool: SqlitePool, config: &Config) -> anyhow::Result<Self> {
        let rows: Vec<(String, String)> = sqlx::query_as("SELECT key, value FROM settings")
            .fetch_all(&pool)
            .await?;
        Ok(Self {
            pool,
            cache: RwLock::new(rows.into_iter().collect()),
            env_tmdb: config.tmdb_api_key.clone().filter(|s| !s.is_empty()),
            env_tvdb: config.tvdb_api_key.clone().filter(|s| !s.is_empty()),
        })
    }

    fn def(key: &str) -> Option<&'static SettingDef> {
        DEFS.iter().find(|d| d.key == key)
    }

    pub async fn raw(&self, key: &str) -> Option<String> {
        self.cache.read().await.get(key).cloned()
    }

    pub async fn get(&self, key: &str) -> String {
        match self.raw(key).await {
            Some(v) => v,
            None => Self::def(key).map(|d| d.default.to_string()).unwrap_or_default(),
        }
    }

    pub async fn set(&self, key: &str, value: &str) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        )
        .bind(key)
        .bind(value)
        .bind(chrono::Utc::now())
        .execute(&self.pool)
        .await?;
        self.cache.write().await.insert(key.to_string(), value.to_string());
        Ok(())
    }

    /// All user-facing settings with secrets masked.
    pub async fn snapshot(&self) -> HashMap<&'static str, String> {
        let cache = self.cache.read().await;
        DEFS.iter()
            .map(|d| {
                let value = cache.get(d.key).cloned().unwrap_or_else(|| d.default.to_string());
                let value = match d.kind {
                    SettingKind::Secret if !value.is_empty() => mask(&value),
                    _ => value,
                };
                (d.key, value)
            })
            .collect()
    }

    pub fn validate(key: &str, value: &str) -> Result<(), String> {
        let def = Self::def(key).ok_or_else(|| format!("unknown setting {key}"))?;
        match def.kind {
            SettingKind::Number => {
                value
                    .parse::<f64>()
                    .map_err(|_| format!("{} must be a number", def.label))?;
            }
            SettingKind::Bool => {
                if value != "true" && value != "false" {
                    return Err(format!("{} must be true or false", def.label));
                }
            }
            SettingKind::Select => {
                if !def.options.contains(&value) {
                    return Err(format!("{} must be one of {}", def.label, def.options.join(", ")));
                }
            }
            SettingKind::String | SettingKind::Secret => {}
        }
        Ok(())
    }

    pub async fn tmdb_api_key(&self) -> String {
        let saved = self.get("tmdb_api_key").await;
        if !saved.is_empty() {
            return saved;
        }
        self.env_tmdb
            .clone()
            .unwrap_or_else(|| DEFAULT_TMDB_API_KEY.to_string())
    }

    pub async fn tvdb_api_key(&self) -> String {
        let saved = self.get("tvdb_api_key").await;
        if !saved.is_empty() {
            return saved;
        }
        self.env_tvdb
            .clone()
            .unwrap_or_else(|| DEFAULT_TVDB_API_KEY.to_string())
    }

    pub async fn language(&self) -> String {
        self.get("metadata_language").await
    }

    pub async fn registration_mode(&self) -> String {
        self.get("registration_mode").await
    }

    pub async fn default_permissions(&self) -> i64 {
        self.get("default_permissions")
            .await
            .parse()
            .unwrap_or(perm::DEFAULT_USER)
    }

    pub async fn instance_name(&self) -> String {
        self.get("instance_name").await
    }

    pub async fn cache_max_bytes(&self) -> u64 {
        let gb: f64 = self.get("cache_max_gb").await.parse().unwrap_or(20.0);
        (gb.max(0.5) * 1024.0 * 1024.0 * 1024.0) as u64
    }

    pub async fn readahead_bytes(&self) -> u64 {
        let mb: f64 = self.get("readahead_mb").await.parse().unwrap_or(256.0);
        (mb.clamp(8.0, 16_384.0) * 1024.0 * 1024.0) as u64
    }

    pub async fn idle_timeout(&self) -> std::time::Duration {
        let mins: f64 = self.get("idle_timeout_minutes").await.parse().unwrap_or(10.0);
        std::time::Duration::from_secs_f64(mins.max(0.5) * 60.0)
    }

    pub async fn transcode_enabled(&self) -> bool {
        self.get("transcode_mode").await != "off"
    }

    pub async fn probe_on_add(&self) -> bool {
        self.get("probe_on_add").await == "true"
    }
}

fn mask(value: &str) -> String {
    let tail: String = value.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
    format!("••••••••{tail}")
}

pub fn is_masked(value: &str) -> bool {
    value.starts_with("••••")
}
