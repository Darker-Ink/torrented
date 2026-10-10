Vendored copy of `librqbit` 9.0.1 with a stream-only mode:

* `set_stream_only(true)` stops peers from falling back to the regular piece
  queue, so only pieces inside an active stream's read-ahead window are ever
  requested. Without it, every selected file is downloaded in full in the
  background.
* Read-ahead is configurable per stream (`FileStream::set_readahead`) and by
  default (`set_default_stream_readahead`), instead of a fixed 32 MiB.
* Streams wake idle peer tasks when they start, seek, or block on a missing
  piece, so playback doesn't wait for the peers' 5 second poll.
* `FileStream` is exported.

Changes are in `src/torrent_state/streaming.rs`, `src/piece_tracker.rs`,
`src/torrent_state/live/mod.rs`, `src/torrent_state/mod.rs` and `src/lib.rs`.
