//! Bring up a WireGuard tunnel from a provider's .conf file, for torrent
//! traffic only.
//!
//! Unlike `wg-quick`, this doesn't touch the default route: the web UI and
//! everything else keep using the normal network. Torrent sockets are bound
//! to the tunnel interface, and a policy rule sends traffic bound to it into
//! a routing table whose only route is the tunnel. Needs Linux, the `ip` and
//! `wg` tools, and the NET_ADMIN capability. Without the kernel module,
//! `wireguard-go` is used if it's installed.

use std::{path::Path, process::Stdio};

use anyhow::{Context, bail};
use tokio::process::Command;

pub const INTERFACE: &str = "torrented0";
const TABLE: &str = "51871";

/// The parts of a wg-quick config that matter here.
#[derive(Debug, Default, PartialEq)]
pub struct ParsedConfig {
    /// Config `wg setconf` understands (wg-quick-only keys removed).
    pub wg: String,
    pub addresses: Vec<String>,
    pub mtu: Option<u32>,
}

pub fn parse(conf: &str) -> anyhow::Result<ParsedConfig> {
    let mut out = ParsedConfig::default();
    let mut section = String::new();
    let mut peers = 0;
    let mut has_key = false;
    for raw in conf.lines() {
        let line = raw.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            section = line[1..line.len() - 1].trim().to_ascii_lowercase();
            if section == "peer" {
                peers += 1;
            }
            out.wg.push_str(line);
            out.wg.push('\n');
            continue;
        }
        let Some((key, value)) = line.split_once('=') else { continue };
        let (key, value) = (key.trim(), value.trim());
        if section == "interface" {
            match key.to_ascii_lowercase().as_str() {
                "address" => {
                    // Torrent traffic is IPv4 only.
                    out.addresses.extend(
                        value
                            .split(',')
                            .map(str::trim)
                            .filter(|a| !a.is_empty() && !a.contains(':'))
                            .map(|a| if a.contains('/') { a.to_string() } else { format!("{a}/32") }),
                    );
                    continue;
                }
                "mtu" => {
                    out.mtu = value.parse().ok();
                    continue;
                }
                // wg-quick only; DNS, routing and hooks stay untouched.
                "dns" | "table" | "preup" | "postup" | "predown" | "postdown" | "saveconfig" => continue,
                "privatekey" => has_key = true,
                _ => {}
            }
        }
        out.wg.push_str(&format!("{key} = {value}\n"));
    }
    if !has_key {
        bail!("the config has no PrivateKey in its [Interface] section");
    }
    if peers == 0 {
        bail!("the config has no [Peer]");
    }
    if out.addresses.is_empty() {
        bail!("the config has no IPv4 Address");
    }
    Ok(out)
}

async fn run(program: &str, args: &[&str]) -> anyhow::Result<()> {
    let out = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .await
        .with_context(|| format!("running {program} (is it installed?)"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let hint = if err.contains("Operation not permitted") {
            " (needs the NET_ADMIN capability, e.g. cap_add: [NET_ADMIN] in Docker)"
        } else {
            ""
        };
        bail!("{program} {}: {}{hint}", args.join(" "), err.trim());
    }
    Ok(())
}

/// Create (or recreate) the tunnel. Returns the interface name.
pub async fn up(conf: &str, data_dir: &Path) -> anyhow::Result<String> {
    if !cfg!(target_os = "linux") {
        bail!("built-in WireGuard is only available on Linux; use a SOCKS5 proxy or an existing interface instead");
    }
    let parsed = parse(conf)?;
    let dir = data_dir.join("wireguard");
    tokio::fs::create_dir_all(&dir).await?;
    let path = dir.join(format!("{INTERFACE}.conf"));
    tokio::fs::write(&path, &parsed.wg).await?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = tokio::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).await;
    }

    down().await;
    if let Err(kernel) = run("ip", &["link", "add", "dev", INTERFACE, "type", "wireguard"]).await {
        // No kernel module: fall back to the userspace implementation.
        if run("wireguard-go", &[INTERFACE]).await.is_err() {
            return Err(kernel.context("the kernel has no WireGuard support and wireguard-go isn't installed"));
        }
        tracing::info!("using wireguard-go (no WireGuard kernel module)");
    }
    let result = async {
        run("wg", &["setconf", INTERFACE, &path.to_string_lossy()]).await?;
        for addr in &parsed.addresses {
            run("ip", &["-4", "address", "add", addr, "dev", INTERFACE]).await?;
        }
        let mtu = parsed.mtu.unwrap_or(1420).to_string();
        run("ip", &["link", "set", "mtu", &mtu, "up", "dev", INTERFACE]).await?;
        run("ip", &["-4", "route", "replace", "default", "dev", INTERFACE, "table", TABLE]).await?;
        run("ip", &["-4", "rule", "add", "oif", INTERFACE, "table", TABLE, "priority", TABLE]).await?;
        anyhow::Ok(())
    }
    .await;
    // The key is in the kernel now; don't leave it lying around.
    let _ = tokio::fs::remove_file(&path).await;
    if let Err(e) = result {
        down().await;
        return Err(e);
    }
    tracing::info!(interface = INTERFACE, "WireGuard tunnel up");
    Ok(INTERFACE.to_string())
}

/// Remove the tunnel if it exists. Never fails.
pub async fn down() {
    if !cfg!(target_os = "linux") || !crate::torrents::engine::interface_exists(INTERFACE) {
        return;
    }
    let _ = run("ip", &["-4", "rule", "del", "oif", INTERFACE, "table", TABLE]).await;
    let _ = run("ip", &["link", "del", "dev", INTERFACE]).await;
    tracing::info!(interface = INTERFACE, "WireGuard tunnel removed");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_wg_quick_keys() {
        let conf = "[Interface]
PrivateKey = aaaa
Address = 10.2.0.2/32, fd00::2/128
DNS = 10.2.0.1
MTU = 1380
PostUp = iptables -A ...

[Peer]
PublicKey = bbbb
AllowedIPs = 0.0.0.0/0, ::/0
Endpoint = 1.2.3.4:51820 # comment
";
        let p = parse(conf).unwrap();
        assert_eq!(p.addresses, vec!["10.2.0.2/32"]);
        assert_eq!(p.mtu, Some(1380));
        assert!(!p.wg.contains("DNS"));
        assert!(!p.wg.contains("Address"));
        assert!(!p.wg.contains("PostUp"));
        assert!(p.wg.contains("Endpoint = 1.2.3.4:51820\n"));
        assert!(parse("[Interface]\nPrivateKey = x\n").is_err());
    }
}
