export type MediaKind = "movie" | "tv";

export type User = {
  id: number;
  username: string;
  display_name: string | null;
  role: "owner" | "admin" | "user";
  permissions: number;
  effective_permissions: number;
  granted: string[];
  disabled: boolean;
  created_at: string;
  last_seen_at: string | null;
};

export type Instance = {
  name: string;
  version: string;
  setup_required: boolean;
  registration: "open" | "invite" | "closed";
  ffmpeg: boolean;
  ffprobe: boolean;
  user: User | null;
};

export type CastMember = {
  name: string;
  character: string | null;
  profile_path: string | null;
};

export type MediaCard = {
  id: number;
  kind: MediaKind;
  tmdb_id: number;
  title: string;
  year: number | null;
  overview: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  logo_path: string | null;
  rating: number | null;
  certification: string | null;
  runtime: number | null;
  genres: string[];
  added_at: string;
  available: boolean;
};

export type Media = MediaCard & {
  tvdb_id: number | null;
  imdb_id: string | null;
  original_title: string | null;
  tagline: string | null;
  status: string | null;
  release_date: string | null;
  vote_count: number | null;
  original_language: string | null;
  networks: string[];
  cast_members: CastMember[];
  trailer_key: string | null;
  updated_at: string;
};

export type Season = {
  id: number;
  season_number: number;
  name: string | null;
  overview: string | null;
  poster_path: string | null;
  air_date: string | null;
  episode_count: number;
  available_episodes: number;
};

export type PlayableFile = {
  file_id: number;
  torrent_id: number;
  torrent_name: string;
  path: string;
  size: number;
  resolution: string | null;
  video_codec: string | null;
  audio_codec: string | null;
  duration: number | null;
  source: string | null;
  hdr: string | null;
  release_group: string | null;
};

export type ProgressInfo = {
  position: number;
  duration: number | null;
  completed: boolean;
};

export type Episode = {
  id: number;
  media_id: number;
  season_number: number;
  episode_number: number;
  absolute_number: number | null;
  name: string | null;
  overview: string | null;
  still_path: string | null;
  air_date: string | null;
  runtime: number | null;
  rating: number | null;
  files: PlayableFile[];
  progress: ProgressInfo | null;
};

export type PlayTarget = {
  file_id: number;
  position: number;
  duration: number | null;
  season_number?: number;
  episode_number?: number;
  episode_name?: string | null;
};

export type TitleDetail = {
  media: Media;
  seasons: Season[];
  in_watchlist: boolean;
  torrent_count: number;
  play: PlayTarget | null;
  files: PlayableFile[];
  progress: { position: number; duration: number | null; completed: boolean; season_number: number; episode_number: number } | null;
  request: { id: number; status: RequestStatus } | null;
};

export type ContinueItem = {
  media: MediaCard;
  target: { season_number: number; episode_number: number; episode_name: string | null };
  position: number;
  duration: number | null;
  updated_at: string;
};

export type HomeRow =
  | { id: string; title: string; type: "media"; items: MediaCard[] }
  | { id: string; title: string; type: "continue"; items: ContinueItem[] };

export type Home = {
  hero: MediaCard[];
  rows: HomeRow[];
};

export type DiscoverItem = {
  kind: MediaKind;
  tmdb_id: number;
  title: string;
  original_title: string | null;
  overview: string | null;
  year: number | null;
  release_date: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  rating: number | null;
  vote_count: number | null;
  media_id: number | null;
  available: boolean;
  request_status: RequestStatus | null;
};

export type DiscoverPage = {
  page: number;
  total_pages: number;
  total_results: number;
  results: DiscoverItem[];
};

export type SeasonSummary = {
  season_number: number;
  name: string | null;
  overview: string | null;
  poster_path: string | null;
  air_date: string | null;
  episode_count: number;
};

export type DiscoverDetail = {
  kind: MediaKind;
  tmdb_id: number;
  title: string;
  overview: string | null;
  tagline: string | null;
  status: string | null;
  release_date: string | null;
  year: number | null;
  runtime: number | null;
  rating: number | null;
  certification: string | null;
  genres: string[];
  networks: string[];
  cast: CastMember[];
  poster_path: string | null;
  backdrop_path: string | null;
  logo_path: string | null;
  trailer_key: string | null;
  seasons: SeasonSummary[];
  media_id: number | null;
  request: { id: number; status: RequestStatus } | null;
};

export type RequestStatus = "pending" | "approved" | "declined" | "available";

export type MediaRequest = {
  id: number;
  user_id: number;
  requested_by: string;
  kind: MediaKind;
  tmdb_id: number;
  title: string;
  year: number | null;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string | null;
  seasons: number[] | null;
  note: string | null;
  status: RequestStatus;
  response: string | null;
  handled_by_name: string | null;
  created_at: string;
  updated_at: string;
  media_id: number | null;
};

export type TorrentFile = {
  id: number;
  file_index: number;
  path: string;
  size: number;
  kind: "video" | "subtitle" | "other";
  is_sample: boolean;
  season_number: number | null;
  episode_numbers: number[];
  mapping: "auto" | "manual" | "ignored";
  language: string | null;
  container: string | null;
  resolution: string | null;
  width: number | null;
  height: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  duration: number | null;
  probe: {
    format?: string | null;
    bitrate?: number | null;
    hdr?: boolean;
    audio?: AudioTrack[];
    subtitles?: { index: number; codec: string | null; language: string | null; title: string | null }[];
  } | null;
  probed_at: string | null;
  linked_episodes: number;
};

export type Torrent = {
  id: number;
  info_hash: string;
  media_id: number;
  name: string;
  magnet: string;
  total_size: number;
  piece_length: number | null;
  file_count: number;
  trackers: string[];
  resolution: string | null;
  source: string | null;
  video_codec: string | null;
  audio: string | null;
  hdr: string | null;
  release_group: string | null;
  added_at: string;
};

export type TorrentJob = {
  info_hash: string;
  kind: MediaKind;
  tmdb_id: number;
  name: string | null;
  status: "resolving" | "probing" | "done" | "error";
  error: string | null;
  warnings: string[];
  user_id: number | null;
  added_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Sources = {
  torrents: { torrent: Torrent; files: TorrentFile[]; job: TorrentJob | null }[];
  pending: TorrentJob[];
};

export type AudioTrack = {
  index: number;
  codec: string | null;
  channels: number | null;
  language: string | null;
  title: string | null;
  default: boolean;
};

export type SubtitleOption = {
  file_id: number;
  language: string | null;
  label: string;
  url: string;
};

export type PlayInfo = {
  file_id: number;
  session_id: number;
  mode: "direct" | "remux" | "transcode";
  reason: string;
  url: string;
  seekable: boolean;
  duration: number | null;
  resume_at: number;
  audio_tracks: AudioTrack[];
  subtitles: SubtitleOption[];
  file: {
    path: string;
    size: number;
    resolution: string | null;
    video_codec: string | null;
    audio_codec: string | null;
  };
  media: {
    id: number;
    kind: MediaKind;
    tmdb_id: number;
    title: string;
    year: number | null;
    backdrop_path: string | null;
    logo_path: string | null;
    poster_path: string | null;
  };
  episode: {
    season_number: number;
    episode_numbers: number[];
    name: string | null;
    still_path: string | null;
  } | null;
  next: { file_id: number; season_number: number; episode_number: number; name: string | null } | null;
};

export type FileStatus = {
  active: boolean;
  progress: {
    size: number;
    downloaded: number;
    download_mbps: number;
    peers: number;
  } | null;
};

export type PermissionInfo = {
  key: string;
  bit: number;
  label: string;
  description: string;
};

export type Invite = {
  code: string;
  permissions: number;
  max_uses: number;
  uses: number;
  note: string | null;
  expires_at: string | null;
  created_at: string;
  created_by_name: string | null;
};

export type ActiveTorrent = {
  info_hash: string;
  name: string;
  active_streams: number;
  files: number[];
  downloaded_bytes: number;
  uploaded_bytes: number;
  download_mbps: number;
  upload_mbps: number;
  peers: number;
  cache_bytes: number;
  idle_seconds: number;
  age_seconds: number;
};

export type LibraryInfo = {
  schema_version: number;
  library_id: string | null;
  created_at: string | null;
  titles: number;
  movies: number;
  shows: number;
  episodes: number;
  torrents: number;
  files: number;
  total_size: number;
};

export type Overview = {
  version: string;
  uptime_seconds: number;
  schema: { main: number; media: number };
  library: LibraryInfo;
  users: number;
  pending_requests: number;
  running_jobs: number;
  failed_jobs: number;
  now_playing: {
    id: number;
    username: string | null;
    title: string | null;
    season_number: number | null;
    episode_number: number | null;
    mode: string;
    started_at: string;
    ended_at: string | null;
    bytes_sent: number;
  }[];
  engine: {
    active: ActiveTorrent[];
    cache_bytes: number;
    cache_limit: number;
    listen_addr: string | null;
  };
  tools: { ffmpeg: string | null; ffprobe: string | null; ffmpeg_version: string | null };
};

export type SettingDef = {
  key: string;
  label: string;
  description: string;
  kind: "string" | "secret" | "number" | "bool" | "select";
  default: string;
  options?: string[];
  group: string;
};

export type SettingsResponse = {
  definitions: SettingDef[];
  values: Record<string, string>;
};

export type LogEntry = {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  target: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
};

export type StreamEntry = {
  id: number;
  username: string | null;
  kind: MediaKind | null;
  tmdb_id: number | null;
  title: string | null;
  season_number: number | null;
  episode_number: number | null;
  mode: string;
  ip: string | null;
  user_agent: string | null;
  started_at: string;
  ended_at: string | null;
  bytes_sent: number;
};

export type Paged<T> = { items: T[]; total: number; page: number; limit: number };
