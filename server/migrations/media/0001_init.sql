-- Library database. Self-contained so it can be exported and shared between
-- instances; nothing in here references main.db row ids except the
-- informational `added_by` columns.

INSERT INTO schema_meta (key, value) VALUES
    ('library_id', lower(hex(randomblob(16)))),
    ('created_at', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
ON CONFLICT (key) DO NOTHING;

CREATE TABLE media (
    id                    INTEGER PRIMARY KEY,
    kind                  TEXT    NOT NULL CHECK (kind IN ('movie', 'tv')),
    tmdb_id               INTEGER NOT NULL,
    tvdb_id               INTEGER,
    imdb_id               TEXT,
    title                 TEXT    NOT NULL,
    original_title        TEXT,
    sort_title            TEXT,
    overview              TEXT,
    tagline               TEXT,
    status                TEXT,
    release_date          TEXT,
    year                  INTEGER,
    runtime               INTEGER,
    rating                REAL,
    vote_count            INTEGER,
    certification         TEXT,
    original_language     TEXT,
    genres                TEXT    NOT NULL DEFAULT '[]', -- JSON array of names
    networks              TEXT    NOT NULL DEFAULT '[]', -- JSON array of names
    cast_members          TEXT    NOT NULL DEFAULT '[]', -- JSON array of {name, character, profile_path}
    poster_path           TEXT,
    backdrop_path         TEXT,
    logo_path             TEXT,
    trailer_key           TEXT,
    added_by              INTEGER,
    added_at              TEXT    NOT NULL,
    updated_at            TEXT    NOT NULL,
    metadata_refreshed_at TEXT,
    UNIQUE (kind, tmdb_id)
);
CREATE INDEX media_added ON media (added_at DESC);
CREATE INDEX media_title ON media (sort_title);

CREATE TABLE seasons (
    id            INTEGER PRIMARY KEY,
    media_id      INTEGER NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    season_number INTEGER NOT NULL,
    name          TEXT,
    overview      TEXT,
    poster_path   TEXT,
    air_date      TEXT,
    episode_count INTEGER NOT NULL DEFAULT 0,
    UNIQUE (media_id, season_number)
);

CREATE TABLE episodes (
    id              INTEGER PRIMARY KEY,
    media_id        INTEGER NOT NULL REFERENCES media (id) ON DELETE CASCADE,
    season_number   INTEGER NOT NULL,
    episode_number  INTEGER NOT NULL,
    absolute_number INTEGER,
    name            TEXT,
    overview        TEXT,
    still_path      TEXT,
    air_date        TEXT,
    runtime         INTEGER,
    rating          REAL,
    tmdb_id         INTEGER,
    tvdb_id         INTEGER,
    UNIQUE (media_id, season_number, episode_number)
);

CREATE TABLE torrents (
    id            INTEGER PRIMARY KEY,
    info_hash     TEXT    NOT NULL UNIQUE,
    media_id      INTEGER REFERENCES media (id) ON DELETE CASCADE,
    name          TEXT    NOT NULL,
    magnet        TEXT,
    torrent_file  BLOB,
    total_size    INTEGER NOT NULL DEFAULT 0,
    piece_length  INTEGER,
    file_count    INTEGER NOT NULL DEFAULT 0,
    trackers      TEXT    NOT NULL DEFAULT '[]',
    status        TEXT    NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'scanning', 'ready', 'error')),
    error         TEXT,
    resolution    TEXT,
    source        TEXT,
    video_codec   TEXT,
    audio         TEXT,
    hdr           TEXT,
    release_group TEXT,
    added_by      INTEGER,
    added_by_name TEXT,
    added_at      TEXT    NOT NULL,
    scanned_at    TEXT
);
CREATE INDEX torrents_media ON torrents (media_id);

CREATE TABLE torrent_files (
    id              INTEGER PRIMARY KEY,
    torrent_id      INTEGER NOT NULL REFERENCES torrents (id) ON DELETE CASCADE,
    file_index      INTEGER NOT NULL,
    path            TEXT    NOT NULL,
    size            INTEGER NOT NULL,
    kind            TEXT    NOT NULL CHECK (kind IN ('video', 'subtitle', 'other')),
    is_sample       INTEGER NOT NULL DEFAULT 0,
    season_number   INTEGER,
    episode_numbers TEXT    NOT NULL DEFAULT '[]', -- JSON array, multi-episode files have several
    mapping         TEXT    NOT NULL DEFAULT 'auto' CHECK (mapping IN ('auto', 'manual', 'ignored')),
    language        TEXT,
    container       TEXT,
    resolution      TEXT,
    width           INTEGER,
    height          INTEGER,
    video_codec     TEXT,
    audio_codec     TEXT,
    duration        REAL,
    probe           TEXT, -- JSON summary of streams
    probe_error     TEXT,
    probed_at       TEXT,
    UNIQUE (torrent_id, file_index)
);

CREATE TABLE file_episodes (
    file_id    INTEGER NOT NULL REFERENCES torrent_files (id) ON DELETE CASCADE,
    episode_id INTEGER NOT NULL REFERENCES episodes (id) ON DELETE CASCADE,
    PRIMARY KEY (file_id, episode_id)
);
CREATE INDEX file_episodes_episode ON file_episodes (episode_id);
