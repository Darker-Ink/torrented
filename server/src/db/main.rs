use super::Migration;

pub const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    name: "init",
    sql: include_str!("../../migrations/main/0001_init.sql"),
}];
