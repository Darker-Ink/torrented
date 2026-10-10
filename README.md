<p align="center">
  <img src="web/public/logo.svg" width="72" alt="" />
</p>

<h1 align="center">torrented</h1>

<p align="center">A self-hosted, Netflix-style library for your own torrents. Stream straight from the swarm — nothing is downloaded up front.</p>

---

You add movies and shows from TMDB/TVDB, attach torrents to them, and everyone
on your server can browse and stream them. When someone presses play, only the
file they're watching is fetched, pieces are prioritised around the playhead,
and once nobody has watched a torrent for a while it's dropped together with
its cached pieces.

It's one binary. Run it, open the browser, finish the setup wizard.

## Features

- **Streaming from the swarm** – seekable HTTP streams backed by
  [librqbit](https://github.com/ikatson/rqbit), with an on-disk cache that is
  size-limited, evicted when idle and wiped on start.
- **Sonarr/Radarr-style scanning** – torrents are read in list-only mode, every
  file is classified and parsed (`S01E01E02`, `1x05`, season packs, season
  folders, anime absolute numbering…) and matched to episodes. Files are then
  partially scanned with ffprobe, which only pulls the pieces holding the
  container headers, to confirm codecs, resolution and duration. Anything that
  looks off is flagged, and mappings can be fixed by hand.
- **Plays in the browser** – browser-friendly files play directly; MKV, AC-3,
  HEVC and friends are remuxed or transcoded on the fly with ffmpeg. SRT/ASS
  subtitles inside torrents are converted to WebVTT.
- **Users, permissions, invites and requests** – fine-grained permissions,
  invite links, a request queue with approvals, watch progress, "continue
  watching", My List, an audit log and playback history.
- **Two databases** – `main.db` holds instance data (accounts, progress, logs,
  settings). `media.db` holds only the library (titles, episodes, torrents and
  what's in them), so it can be exported and imported into another server.
  Both are versioned and migrate themselves; older library exports are
  upgraded on import.

## Running

### Docker

```sh
curl -O https://raw.githubusercontent.com/Darker-Ink/torrented/master/docker-compose.yml
docker compose up -d
# → http://localhost:8080
```

The image (`ghcr.io/darker-ink/torrented`, amd64 + arm64) includes ffmpeg and
keeps everything in the `torrented-data` volume. Forward port `6881` (TCP and
UDP) on your router for better speeds. See `docker-compose.yml` for the
available options; to build the image yourself use `docker compose build` with
the `build: .` line uncommented, or `docker build -t torrented .`.

### Binary

Grab a build for your platform from the
[releases](https://github.com/Darker-Ink/torrented/releases) (or the artifacts
of the latest [Build workflow](https://github.com/Darker-Ink/torrented/actions/workflows/build.yml)
run), then:

```sh
./torrented
# → http://localhost:8080
```

Linux builds are statically linked and run on any distro.

Data lives in `./data` by default:

| Path               | What                                   |
| ------------------ | -------------------------------------- |
| `data/main.db`     | Users, sessions, requests, logs, settings |
| `data/media.db`    | The shareable library                  |
| `data/cache/`      | Pieces of torrents being streamed (cleared on start) |
| `data/dht.json`    | DHT routing table                      |

Install **ffmpeg** (with ffprobe) for remuxing, transcoding and file scanning.
Without it, MP4/WebM files still play directly.

### Options

Every flag can also be set with an environment variable.

| Flag | Env | Default | |
| --- | --- | --- | --- |
| `--listen` | `TORRENTED_LISTEN` | `0.0.0.0:8080` | HTTP address |
| `--data-dir` | `TORRENTED_DATA_DIR` | `./data` | Databases and cache |
| `--peer-port` | `TORRENTED_PEER_PORT` | random | Incoming BitTorrent port |
| `--peer` | `TORRENTED_PEERS` | | Peers to always try (e.g. a seedbox), comma separated |
| `--tmdb-api-key` | `TMDB_API_KEY` | built in | Overridden by the value in Settings |
| `--tvdb-api-key` | `TVDB_API_KEY` | built in | Overridden by the value in Settings |
| `--ffmpeg` / `--ffprobe` | `TORRENTED_FFMPEG` / `TORRENTED_FFPROBE` | from `PATH` | |
| `--secure-cookies` | `TORRENTED_SECURE_COOKIES` | off | Enable behind HTTPS |
| `--web-dir` | `TORRENTED_WEB_DIR` | embedded | Serve the UI from disk instead |

Cache size, idle timeout, registration mode, default permissions, metadata
language and API keys are all changeable from **Admin → Settings**.

## Building

Requires Rust (stable) and Node.js 20+ (or bun/pnpm).

```sh
cargo build --release
```

`server/build.rs` builds `web/` and the result is embedded in the binary, so
`target/release/torrented` is all you need to ship. Set
`TORRENTED_SKIP_WEB_BUILD=1` to skip the frontend build.

CI (`.github/workflows/build.yml`) builds Linux (static musl, x86_64/arm64),
macOS (arm64/x86_64) and Windows binaries on every push and uploads them as
workflow artifacts. Pushes to `master` also publish the Docker image, and
`v*` tags create a GitHub release with the binaries attached.

### Development

```sh
# backend on :8080
cargo run -- --data-dir ./data

# frontend with hot reload on :5173 (proxies /api to :8080)
cd web && npm install && npm run dev
```

## Layout

```
server/            Rust backend (axum, librqbit, sqlx/SQLite)
  migrations/main  main.db schema versions
  migrations/media media.db schema versions
  src/torrents     engine, release-name parser, scanning and episode matching
  src/streaming    range streaming, ffprobe/ffmpeg, subtitles
  src/routes       HTTP API
web/               React app (Vite, Tailwind, Headless UI)
  src/pages        file-based routes (vite-plugin-pages)
  src/features/*/components
vendor/            patched librqbit-dualstack-sockets (IPv4 fallback)
docker/            Dockerfile used by CI to package prebuilt binaries
```
