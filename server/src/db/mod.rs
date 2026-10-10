//! SQLite plumbing shared by both databases.
//!
//! The server keeps two databases:
//!
//! * `main.db`  – users, sessions, requests, watch progress, logs, settings.
//!   Everything that is specific to *this* instance.
//! * `media.db` – the library itself: titles, seasons, episodes, torrents and
//!   how torrent files map to episodes. It is self-contained so it can be
//!   exported and imported into another instance.
//!
//! Each database carries its own `schema_meta.schema_version` and a list of
//! ordered migrations. Imported media databases are migrated forward with the
//! same runner before they are merged.

pub mod main;
pub mod media;

use std::{path::Path, str::FromStr, time::Duration};

use anyhow::{Context, bail};
use sqlx::{
    Connection, Executor, SqliteConnection, SqlitePool,
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
};

pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
}

fn connect_options(path: &Path) -> anyhow::Result<SqliteConnectOptions> {
    let url = format!("sqlite://{}", path.display());
    Ok(SqliteConnectOptions::from_str(&url)?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Normal)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(10)))
}

pub async fn open_pool(path: &Path) -> anyhow::Result<SqlitePool> {
    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(connect_options(path)?)
        .await
        .with_context(|| format!("opening database {}", path.display()))?;
    Ok(pool)
}

/// Open a single standalone connection, used for one-off work on files such
/// as imported media databases.
pub async fn open_connection(path: &Path) -> anyhow::Result<SqliteConnection> {
    let opts = connect_options(path)?.journal_mode(SqliteJournalMode::Delete);
    Ok(SqliteConnection::connect_with(&opts).await?)
}

pub async fn schema_version(conn: &mut SqliteConnection) -> anyhow::Result<i64> {
    let exists: Option<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'",
    )
    .fetch_optional(&mut *conn)
    .await?;
    if exists.is_none() {
        return Ok(0);
    }
    let version: Option<String> =
        sqlx::query_scalar("SELECT value FROM schema_meta WHERE key = 'schema_version'")
            .fetch_optional(&mut *conn)
            .await?;
    Ok(version.and_then(|v| v.parse().ok()).unwrap_or(0))
}

/// Apply every migration newer than the database's current version, each in
/// its own transaction. Returns the resulting schema version.
pub async fn migrate(
    conn: &mut SqliteConnection,
    label: &str,
    migrations: &[Migration],
) -> anyhow::Result<i64> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    )
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )",
    )
    .execute(&mut *conn)
    .await?;

    let current = schema_version(conn).await?;
    let latest = migrations.last().map(|m| m.version).unwrap_or(0);
    if current > latest {
        bail!(
            "{label} database is at schema version {current}, but this build only knows up to {latest}; \
             upgrade torrented before using it"
        );
    }

    for m in migrations {
        if m.version <= current {
            continue;
        }
        tracing::info!(db = label, version = m.version, name = m.name, "applying migration");
        let mut tx = conn.begin().await?;
        tx.execute(m.sql)
            .await
            .with_context(|| format!("{label} migration {} ({})", m.version, m.name))?;
        sqlx::query("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
            .bind(m.version)
            .bind(m.name)
            .bind(chrono::Utc::now())
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(m.version.to_string())
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
    }

    Ok(latest.max(current))
}

/// Convenience to run migrations on a pool.
pub async fn migrate_pool(
    pool: &SqlitePool,
    label: &str,
    migrations: &[Migration],
) -> anyhow::Result<i64> {
    let mut conn = pool.acquire().await?;
    migrate(&mut conn, label, migrations).await
}
