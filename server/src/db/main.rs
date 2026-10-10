use super::Migration;

pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "init",
        sql: include_str!("../../migrations/main/0001_init.sql"),
    },
    Migration {
        version: 2,
        name: "request_torrents",
        sql: include_str!("../../migrations/main/0002_request_torrents.sql"),
    },
];
