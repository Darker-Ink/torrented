-- A request can carry a torrent suggested by the person asking. It's checked
-- automatically (does it match the title, cover the seasons, have seeders)
-- and attached to the title when the request is approved.
ALTER TABLE requests ADD COLUMN torrent_source   TEXT;    -- magnet, URL or 'upload'
ALTER TABLE requests ADD COLUMN torrent_info_hash TEXT;
ALTER TABLE requests ADD COLUMN torrent_name     TEXT;
ALTER TABLE requests ADD COLUMN torrent_metainfo BLOB;    -- resolved .torrent, so approval needs no peers
ALTER TABLE requests ADD COLUMN review_status    TEXT
    CHECK (review_status IN ('checking', 'pass', 'warn', 'fail', 'error'));
ALTER TABLE requests ADD COLUMN review           TEXT;    -- JSON report
ALTER TABLE requests ADD COLUMN torrent_attached INTEGER NOT NULL DEFAULT 0;
