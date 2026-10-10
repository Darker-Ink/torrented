//! Builds the web UI so it can be embedded into the binary.
//!
//! * Release builds always rebuild `web/dist` (when sources changed).
//! * Debug builds only build it if it's missing; during frontend work run the
//!   Vite dev server instead.
//! * Set `TORRENTED_SKIP_WEB_BUILD=1` to never touch the web UI.
//!
//! If no Node package manager is available a placeholder page is embedded so
//! the server still compiles.

use std::{
    env, fs,
    path::Path,
    process::Command,
};

fn package_manager() -> Option<&'static str> {
    ["bun", "pnpm", "npm"].into_iter().find(|pm| {
        Command::new(pm)
            .arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    })
}

fn run(pm: &str, args: &[&str], dir: &Path) -> bool {
    let status = Command::new(pm).args(args).current_dir(dir).status();
    matches!(status, Ok(s) if s.success())
}

fn main() {
    let web = Path::new("../web");
    let dist = web.join("dist");
    let index = dist.join("index.html");

    println!("cargo:rerun-if-env-changed=TORRENTED_SKIP_WEB_BUILD");
    for p in ["src", "public", "index.html", "package.json", "vite.config.ts"] {
        println!("cargo:rerun-if-changed=../web/{p}");
    }

    let skip = env::var("TORRENTED_SKIP_WEB_BUILD").is_ok_and(|v| v != "0" && !v.is_empty());
    let release = env::var("PROFILE").is_ok_and(|p| p == "release");
    let want = !skip && (release || !index.exists()) && web.join("package.json").exists();

    if want {
        match package_manager() {
            Some(pm) => {
                let installed = web.join("node_modules").exists() || run(pm, &["install"], web);
                if !(installed && run(pm, &["run", "build"], web)) {
                    println!("cargo:warning=building the web UI with {pm} failed");
                }
            }
            None => println!("cargo:warning=no node package manager found; the web UI will not be embedded"),
        }
    }

    if !index.exists() {
        fs::create_dir_all(&dist).expect("creating web/dist");
        fs::write(
            &index,
            "<!doctype html><meta charset=utf-8><title>torrented</title>\
             <p style=\"font-family:sans-serif\">The web UI wasn't built into this binary. \
             Install Node.js and rebuild, or run the dev server from <code>web/</code>.</p>",
        )
        .expect("writing placeholder index.html");
    }
}
