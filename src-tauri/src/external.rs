//! Reaching outside the app: revealing files in the OS file manager, finding
//! UVtools, opening external URLs, launching external programs and fetching
//! remote text or images. Moved out of main.rs.

#[allow(unused_imports)]
use super::*;

/// Open the folder containing the given path in the OS file manager.
/// On Windows this uses `explorer /select,<path>` to highlight the file.
/// On macOS it uses `open -R <path>`. On Linux it falls back to `xdg-open`
/// on the parent directory.
#[tauri::command]
pub async fn reveal_in_file_manager(path: String) -> Result<(), String> {
    let path = path.trim().to_string();
    if path.is_empty() {
        return Err("Path is empty".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("Failed to open Explorer: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Failed to reveal in Finder: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        let p = std::path::Path::new(&path);
        let dir = p.parent().unwrap_or(p);
        std::process::Command::new("xdg-open")
            .arg(dir)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {e}"))?;
    }

    Ok(())
}

/// Executable names to look for on PATH. Everywhere but Windows UVTools ships
/// the same plain binary — `UVtools` inside the macOS bundle, `UVtools` in the
/// Linux zip — that users sometimes symlink onto PATH in lowercase.
#[cfg(target_os = "windows")]
pub(crate) const UVTOOLS_PATH_EXECUTABLES: &[&str] = &["UVTools.exe"];
#[cfg(not(target_os = "windows"))]
pub(crate) const UVTOOLS_PATH_EXECUTABLES: &[&str] = &["UVtools", "uvtools"];

/// Expand a leading `~/` against HOME. Candidate paths come from the frontend,
/// which has no way to resolve the home directory itself.
pub(crate) fn expand_tilde(path: &str) -> std::path::PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return std::path::PathBuf::from(home).join(rest);
        }
    }
    std::path::PathBuf::from(path)
}

/// A candidate counts as UVTools when it is an executable file or, on macOS, an
/// `.app` bundle — which is a directory, so `is_file()` alone rejects it.
pub(crate) fn is_uvtools_install(path: &std::path::Path) -> bool {
    if path.is_file() {
        return true;
    }

    cfg!(target_os = "macos")
        && path.is_dir()
        && path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("app"))
}

#[tauri::command]
pub async fn discover_uvtools_path(candidates: Vec<String>) -> Result<Option<String>, String> {
    // Check candidate absolute paths first
    for candidate in &candidates {
        let p = expand_tilde(candidate);
        if is_uvtools_install(&p) {
            return Ok(Some(p.to_string_lossy().to_string()));
        }
    }

    // Then PATH, for installs that are not in a standard location
    if let Ok(path_env) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_env) {
            for name in UVTOOLS_PATH_EXECUTABLES {
                let exec_candidate = dir.join(name);
                if exec_candidate.is_file() {
                    return Ok(Some(exec_candidate.to_string_lossy().to_string()));
                }
            }
        }
    }

    Ok(None)
}

/// Schemes `open_external_url` may hand to the operating system.
pub(crate) const EXTERNAL_URL_SCHEMES: &[&str] = &["http", "https", "mailto"];

/// Validates a URL before it leaves the app. Only absolute http(s)/mailto URLs
/// are accepted, so the command can never be used to launch a local file,
/// executable or custom protocol handler. Returns the normalized URL; its
/// serialization percent-encodes spaces and quotes.
pub(crate) fn validate_external_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("URL is empty".to_string());
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err("URL contains control characters".to_string());
    }
    let parsed = url::Url::parse(trimmed).map_err(|e| format!("Invalid URL: {e}"))?;
    if !EXTERNAL_URL_SCHEMES.contains(&parsed.scheme()) {
        return Err(format!("URL scheme '{}' is not allowed", parsed.scheme()));
    }
    if parsed.scheme() != "mailto" && parsed.host_str().map_or(true, str::is_empty) {
        return Err("URL has no host".to_string());
    }
    Ok(parsed.to_string())
}

/// Open a URL in the default system browser (cross-platform).
///
/// The URL is validated first and is never passed through a shell: on
/// Windows `cmd /c start` would re-parse characters such as `&` and `|` as
/// command separators.
#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    let url = validate_external_url(&url)?;

    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", &url])
        .spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open").arg(&url).spawn();

    result.map_err(|e| format!("Failed to open URL in browser: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn launch_external_process(exe_path: String, file_arg: String) -> Result<(), String> {
    let exe_path = exe_path.trim().to_string();
    let file_arg = file_arg.trim().to_string();

    if exe_path.is_empty() {
        return Err("Executable path is empty".to_string());
    }

    // A macOS `.app` bundle is a directory: it has to be started through
    // `open -a`. The file goes in as a command-line argument, not as a file to
    // open: UVtools declares no document types, so it ignores the open-document
    // event that `open -a <app> <file>` sends. `-n` starts a new instance,
    // since one already running would never see the arguments. A bare
    // executable (a CLI on PATH, or the binary inside the bundle) still spawns
    // directly.
    #[cfg(target_os = "macos")]
    if std::path::Path::new(&exe_path)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("app"))
    {
        let mut command = std::process::Command::new("open");
        command.arg("-n").arg("-a").arg(&exe_path);
        if !file_arg.is_empty() {
            command.arg("--args").arg(&file_arg);
        }
        command
            .spawn()
            .map_err(|e| format!("Failed to launch external process: {e}"))?;
        return Ok(());
    }

    std::process::Command::new(&exe_path)
        .arg(&file_arg)
        .spawn()
        .map_err(|e| format!("Failed to launch external process: {e}"))?;

    Ok(())
}
/// Fetch a sponsor avatar via Rust (bypasses WebView CORS).
/// Only `https` URLs from the Open Collective avatar hosts are allowed,
/// mirroring the allowlist in `src/app/api/sponsor-avatar/route.ts`.
/// Returns a `data:` URL so the frontend can render it without further network.
#[tauri::command]
pub async fn fetch_sponsor_avatar(url: String) -> Result<String, String> {
    let trimmed = url.trim().to_string();
    if trimmed.is_empty() {
        return Err("URL is empty".to_string());
    }
    let parsed = url::Url::parse(&trimmed).map_err(|e| format!("Invalid url: {e}"))?;
    if parsed.scheme() != "https" {
        return Err("Only https URLs are allowed".to_string());
    }
    let host = parsed.host_str().ok_or("Missing host")?.to_ascii_lowercase();
    const ALLOWED_HOSTS: &[&str] = &[
        "opencollective-production.s3.us-west-1.amazonaws.com",
        "opencollective-production.s3-us-west-1.amazonaws.com",
        "images.opencollective.com",
        "avatars.githubusercontent.com",
    ];
    if !ALLOWED_HOSTS.contains(&host.as_str()) {
        return Err(format!("Host not allowed: {host}"));
    }
    let client = reqwest::Client::new();
    let resp = client
        .get(trimmed)
        .header("Accept", "image/*,*/*")
        .send()
        .await
        .map_err(|e| format!("Fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Upstream {}", resp.status()));
    }
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png")
        .to_string();
    let bytes = resp.bytes().await.map_err(|e| format!("Read failed: {e}"))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{content_type};base64,{b64}"))
}
/// Fetch external JSON/text via Rust (bypasses WebView CORS) for sponsors list.
/// Only `https` URLs from `opencollective.com` are allowed.
#[tauri::command]
pub async fn fetch_external_text(url: String) -> Result<String, String> {
    let trimmed = url.trim().to_string();
    if trimmed.is_empty() {
        return Err("URL is empty".to_string());
    }
    let parsed = url::Url::parse(&trimmed).map_err(|e| format!("Invalid url: {e}"))?;
    if parsed.scheme() != "https" {
        return Err("Only https URLs are allowed".to_string());
    }
    let host = parsed.host_str().ok_or("Missing host")?.to_ascii_lowercase();
    const ALLOWED_HOSTS: &[&str] = &["opencollective.com", "www.opencollective.com", "api.opencollective.com"];
    if !ALLOWED_HOSTS.contains(&host.as_str()) {
        return Err(format!("Host not allowed: {host}"));
    }
    let client = reqwest::Client::new();
    let resp = client
        .get(trimmed)
        .header("Accept", "application/json,*/*")
        .send()
        .await
        .map_err(|e| format!("Fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Upstream {}", resp.status()));
    }
    let text = resp.text().await.map_err(|e| format!("Read failed: {e}"))?;
    Ok(text)
}
