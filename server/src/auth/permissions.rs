use serde::Serialize;

/// Permission bit flags stored on each user. `ADMIN` implies everything.
pub mod perm {
    pub const STREAM: i64 = 1 << 0;
    pub const REQUEST: i64 = 1 << 1;
    pub const ADD_MEDIA: i64 = 1 << 2;
    pub const ADD_TORRENTS: i64 = 1 << 3;
    pub const MANAGE_TORRENTS: i64 = 1 << 4;
    pub const MANAGE_LIBRARY: i64 = 1 << 5;
    pub const MANAGE_REQUESTS: i64 = 1 << 6;
    pub const AUTO_APPROVE: i64 = 1 << 7;
    pub const MANAGE_USERS: i64 = 1 << 8;
    pub const VIEW_LOGS: i64 = 1 << 9;
    pub const MANAGE_SETTINGS: i64 = 1 << 10;
    pub const ADMIN: i64 = 1 << 30;

    pub const DEFAULT_USER: i64 = STREAM | REQUEST;
}

#[derive(Debug, Serialize)]
pub struct PermissionInfo {
    pub key: &'static str,
    pub bit: i64,
    pub label: &'static str,
    pub description: &'static str,
}

pub const ALL: &[PermissionInfo] = &[
    PermissionInfo {
        key: "admin",
        bit: perm::ADMIN,
        label: "Administrator",
        description: "Full access to everything, including all other permissions.",
    },
    PermissionInfo {
        key: "stream",
        bit: perm::STREAM,
        label: "Stream",
        description: "Watch anything in the library.",
    },
    PermissionInfo {
        key: "request",
        bit: perm::REQUEST,
        label: "Request",
        description: "Request movies and shows that are not in the library yet.",
    },
    PermissionInfo {
        key: "auto_approve",
        bit: perm::AUTO_APPROVE,
        label: "Auto-approve requests",
        description: "Requests are approved and added to the library immediately.",
    },
    PermissionInfo {
        key: "add_media",
        bit: perm::ADD_MEDIA,
        label: "Add titles",
        description: "Add movies and shows to the library from TMDB.",
    },
    PermissionInfo {
        key: "add_torrents",
        bit: perm::ADD_TORRENTS,
        label: "Add torrents",
        description: "Attach magnet links or .torrent files to titles.",
    },
    PermissionInfo {
        key: "manage_torrents",
        bit: perm::MANAGE_TORRENTS,
        label: "Manage torrents",
        description: "Edit file mappings, rescan or remove any torrent.",
    },
    PermissionInfo {
        key: "manage_library",
        bit: perm::MANAGE_LIBRARY,
        label: "Manage library",
        description: "Edit or remove titles, refresh metadata, import and export the library.",
    },
    PermissionInfo {
        key: "manage_requests",
        bit: perm::MANAGE_REQUESTS,
        label: "Manage requests",
        description: "Approve or decline requests from other users.",
    },
    PermissionInfo {
        key: "manage_users",
        bit: perm::MANAGE_USERS,
        label: "Manage users",
        description: "Create, edit and disable users and invites.",
    },
    PermissionInfo {
        key: "view_logs",
        bit: perm::VIEW_LOGS,
        label: "View logs",
        description: "See the audit log and streaming history.",
    },
    PermissionInfo {
        key: "manage_settings",
        bit: perm::MANAGE_SETTINGS,
        label: "Manage settings",
        description: "Change instance settings such as API keys and cache limits.",
    },
];

pub const fn has(permissions: i64, required: i64) -> bool {
    permissions & perm::ADMIN != 0 || permissions & required == required
}
