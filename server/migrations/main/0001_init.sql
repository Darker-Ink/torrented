-- Instance database: accounts, sessions, requests, progress and logs.

CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'user' CHECK (role IN ('owner', 'admin', 'user')),
    permissions   INTEGER NOT NULL DEFAULT 0,
    disabled      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL,
    last_seen_at  TEXT
);

CREATE TABLE sessions (
    id           TEXT    PRIMARY KEY, -- sha256 of the cookie token
    user_id      INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    user_agent   TEXT,
    ip           TEXT,
    created_at   TEXT    NOT NULL,
    last_used_at TEXT    NOT NULL,
    expires_at   TEXT    NOT NULL
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE invites (
    code        TEXT    PRIMARY KEY,
    created_by  INTEGER REFERENCES users (id) ON DELETE SET NULL,
    permissions INTEGER NOT NULL,
    max_uses    INTEGER NOT NULL DEFAULT 1,
    uses        INTEGER NOT NULL DEFAULT 0,
    note        TEXT,
    expires_at  TEXT,
    created_at  TEXT    NOT NULL
);

CREATE TABLE settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE requests (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind          TEXT    NOT NULL CHECK (kind IN ('movie', 'tv')),
    tmdb_id       INTEGER NOT NULL,
    title         TEXT    NOT NULL,
    year          INTEGER,
    poster_path   TEXT,
    backdrop_path TEXT,
    overview      TEXT,
    seasons       TEXT, -- JSON array of season numbers, NULL means everything
    note          TEXT,
    status        TEXT    NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'declined', 'available')),
    response      TEXT,
    handled_by    INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at    TEXT    NOT NULL,
    updated_at    TEXT    NOT NULL
);
CREATE INDEX requests_status ON requests (status, created_at);
CREATE INDEX requests_media ON requests (kind, tmdb_id);

-- Progress is keyed by TMDB id and episode numbers rather than media.db row
-- ids so it survives library exports/imports.
CREATE TABLE watch_progress (
    user_id        INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind           TEXT    NOT NULL,
    tmdb_id        INTEGER NOT NULL,
    season_number  INTEGER NOT NULL DEFAULT -1,
    episode_number INTEGER NOT NULL DEFAULT -1,
    info_hash      TEXT    NOT NULL,
    file_index     INTEGER NOT NULL,
    position       REAL    NOT NULL DEFAULT 0,
    duration       REAL,
    completed      INTEGER NOT NULL DEFAULT 0,
    updated_at     TEXT    NOT NULL,
    PRIMARY KEY (user_id, kind, tmdb_id, season_number, episode_number)
);
CREATE INDEX watch_progress_recent ON watch_progress (user_id, updated_at DESC);

CREATE TABLE watchlist (
    user_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind     TEXT    NOT NULL,
    tmdb_id  INTEGER NOT NULL,
    added_at TEXT    NOT NULL,
    PRIMARY KEY (user_id, kind, tmdb_id)
);

-- Background work on torrents (metadata resolution, probing) and who added
-- them. Kept here rather than in media.db because it is instance specific.
CREATE TABLE torrent_jobs (
    id         INTEGER PRIMARY KEY,
    info_hash  TEXT    NOT NULL UNIQUE,
    kind       TEXT    NOT NULL,
    tmdb_id    INTEGER NOT NULL,
    name       TEXT,
    magnet     TEXT,
    status     TEXT    NOT NULL DEFAULT 'resolving'
               CHECK (status IN ('resolving', 'probing', 'done', 'error')),
    error      TEXT,
    warnings   TEXT    NOT NULL DEFAULT '[]', -- JSON array of strings
    user_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TEXT    NOT NULL,
    updated_at TEXT    NOT NULL
);
CREATE INDEX torrent_jobs_media ON torrent_jobs (kind, tmdb_id);

CREATE TABLE audit_log (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER REFERENCES users (id) ON DELETE SET NULL,
    username   TEXT,
    action     TEXT NOT NULL,
    target     TEXT,
    details    TEXT, -- JSON
    ip         TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX audit_log_created ON audit_log (created_at DESC);
CREATE INDEX audit_log_action ON audit_log (action);

CREATE TABLE stream_history (
    id             INTEGER PRIMARY KEY,
    user_id        INTEGER REFERENCES users (id) ON DELETE SET NULL,
    kind           TEXT,
    tmdb_id        INTEGER,
    title          TEXT,
    season_number  INTEGER,
    episode_number INTEGER,
    info_hash      TEXT    NOT NULL,
    file_index     INTEGER NOT NULL,
    mode           TEXT    NOT NULL, -- direct | remux | transcode
    ip             TEXT,
    user_agent     TEXT,
    started_at     TEXT    NOT NULL,
    ended_at       TEXT,
    bytes_sent     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX stream_history_started ON stream_history (started_at DESC);
