use wasi::*;
use std::ffi::CString;
use std::fs::File;
use std::io::{Read, Write};
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
#[derive(Serialize, Deserialize)]
pub struct FileInfo {
    pub name: String,
    pub size: u64,
    pub is_dir: bool,
    pub modified: u64,
}

#[wasm_bindgen]
#[derive(Serialize, Deserialize)]
pub struct NetworkRequest {
    pub url: String,
    pub method: String,
    pub headers: Vec<String>,
    pub body: Option<String>,
}

#[wasm_bindgen]
#[derive(Serialize, Deserialize)]
pub struct NetworkResponse {
    pub status: u16,
    pub headers: Vec<String>,
    pub body: String,
}

// ============ File System Calls ============

#[wasm_bindgen]
pub fn wasi_read_file(path: &str) -> Result<String, String> {
    // Capability-based security: check if path is allowed
    if !is_path_allowed(path) {
        return Err("Access denied".to_string());
    }

    match std::fs::read_to_string(path) {
        Ok(content) => Ok(content),
        Err(e) => Err(format!("Failed to read file: {}", e)),
    }
}

#[wasm_bindgen]
pub fn wasi_write_file(path: &str, content: &str) -> Result<(), String> {
    // Capability-based security: check if path is allowed
    if !is_path_allowed(path) {
        return Err("Access denied".to_string());
    }

    match std::fs::write(path, content) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to write file: {}", e)),
    }
}

#[wasm_bindgen]
pub fn wasi_list_directory(path: &str) -> Result<String, String> {
    if !is_path_allowed(path) {
        return Err("Access denied".to_string());
    }

    match std::fs::read_dir(path) {
        Ok(entries) => {
            let files: Vec<FileInfo> = entries
                .filter_map(|entry| {
                    if let Ok(entry) = entry {
                        let metadata = entry.metadata().ok()?;
                        Some(FileInfo {
                            name: entry.file_name().to_string_lossy().to_string(),
                            size: metadata.len(),
                            is_dir: metadata.is_dir(),
                            modified: metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_secs(),
                        })
                    } else {
                        None
                    }
                })
                .collect();
            
            serde_json::to_string(&files).map_err(|e| format!("Failed to serialize: {}", e))
        }
        Err(e) => Err(format!("Failed to list directory: {}", e)),
    }
}

#[wasm_bindgen]
pub fn wasi_create_directory(path: &str) -> Result<(), String> {
    if !is_path_allowed(path) {
        return Err("Access denied".to_string());
    }

    match std::fs::create_dir_all(path) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to create directory: {}", e)),
    }
}

#[wasm_bindgen]
pub fn wasi_delete_file(path: &str) -> Result<(), String> {
    if !is_path_allowed(path) {
        return Err("Access denied".to_string());
    }

    match std::fs::remove_file(path) {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to delete file: {}", e)),
    }
}

fn is_path_allowed(path: &str) -> bool {
    // Capability-based security: only allow specific paths.
    // The requested path is lexically resolved first (collapsing `.`/`..`
    // segments without touching the filesystem) so embedded traversal can
    // never smuggle a path out of the sandbox roots. Comparison is done on
    // the resolved form against each resolved root, with a separator
    // boundary, so `/tmp/truxify_evil/` or `/tmp/truxify/../...` are rejected.
    let resolved = match resolve_lexically(path) {
        Some(r) => r,
        None => return false,
    };

    let allowed_prefixes = ["/tmp/truxify/", "./data/", "/var/truxify/"];
    for prefix in allowed_prefixes {
        if let Some(root) = resolve_lexically(prefix) {
            if resolved == root || resolved.starts_with(&format!("{}/", root)) {
                return true;
            }
        }
    }
    false
}

// resolve_lexically collapses `.`/`..` segments and normalizes separators
// without performing any filesystem access. A `..` that would pop past the
// beginning of a relative path is preserved (rather than dropped) so that it
// surfaces in the resolved form and fails the sandbox-root check above.
fn resolve_lexically(path: &str) -> Option<String> {
    let mut out: Vec<&str> = Vec::new();
    let absolute = path.starts_with('/');

    for seg in path.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                if out.last() == Some(&"..") || (!absolute && out.is_empty()) {
                    out.push("..");
                } else if out.pop().is_none() {
                    out.push("..");
                }
            }
            seg => out.push(seg),
        }
    }

    let mut resolved = out.join("/");
    if absolute {
        resolved.insert(0, '/');
    }
    Some(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_paths_inside_sandbox_roots() {
        assert!(is_path_allowed("/tmp/truxify/data.json"));
        assert!(is_path_allowed("/tmp/truxify/sub/dir/file.txt"));
        assert!(is_path_allowed("/var/truxify/logs/app.log"));
        assert!(is_path_allowed("./data/cache.json"));
        assert!(is_path_allowed("data/cache.json"));
    }

    #[test]
    fn rejects_traversal_at_prefix_boundary() {
        assert!(!is_path_allowed("/tmp/truxify/../../etc/passwd"));
        assert!(!is_path_allowed("/tmp/truxify/../../../etc/shadow"));
        assert!(!is_path_allowed("./data/../../etc/shadow"));
        assert!(!is_path_allowed("/var/truxify/../etc/passwd"));
        assert!(!is_path_allowed("/tmp/truxify/.."));
    }

    #[test]
    fn rejects_nested_and_internal_traversal() {
        assert!(!is_path_allowed("../data/../../etc/hostname"));
        assert!(!is_path_allowed("/tmp/truxify/a/../../../../etc/passwd"));
        assert!(!is_path_allowed("/etc/passwd"));
        assert!(!is_path_allowed("/tmp/truxify_evil/x"));
    }

    #[test]
    fn allows_traversal_that_stays_inside_root() {
        assert!(is_path_allowed("/tmp/truxify/../truxify/data.json"));
        assert!(is_path_allowed("/tmp/truxify/a/../b/data.json"));
    }

    #[test]
    fn allows_exact_sandbox_root() {
        assert!(is_path_allowed("/tmp/truxify"));
        assert!(is_path_allowed("/tmp/truxify/"));
        assert!(is_path_allowed("./data"));
    }

    #[test]
    fn lexically_resolves_traversal() {
        assert_eq!(resolve_lexically("/tmp/truxify/../../etc/passwd"), Some("/etc/passwd".to_string()));
        assert_eq!(resolve_lexically("./data/../data/x"), Some("data/x".to_string()));
        assert_eq!(resolve_lexically("../data/../../etc/hostname"), Some("../../etc/hostname".to_string()));
    }
}

// ============ Network System Calls ============

#[wasm_bindgen]
pub fn wasi_http_request(request: &str) -> Result<String, String> {
    let req: NetworkRequest = serde_json::from_str(request)
        .map_err(|e| format!("Failed to parse request: {}", e))?;

    // Capability-based security: only allow specific domains
    if !is_url_allowed(&req.url) {
        return Err("Access denied: domain not allowed".to_string());
    }

    // Make HTTP request using stdlib
    // In production: use reqwest or similar
    let response = NetworkResponse {
        status: 200,
        headers: vec!["content-type: application/json".to_string()],
        body: format!("Echo: {}", req.url),
    };

    serde_json::to_string(&response).map_err(|e| format!("Failed to serialize: {}", e))
}

#[wasm_bindgen]
pub fn wasi_get_time() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

#[wasm_bindgen]
pub fn wasi_get_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[wasm_bindgen]
pub fn wasi_sleep(ms: u64) {
    std::thread::sleep(std::time::Duration::from_millis(ms));
}

fn is_url_allowed(url: &str) -> bool {
    // Capability-based security: only allow specific domains
    let allowed_domains = vec![
        "api.truxify.com",
        "localhost",
        "127.0.0.1",
    ];
    
    for domain in allowed_domains {
        if url.contains(domain) {
            return true;
        }
    }
    false
}

// ============ Process System Calls ============

#[wasm_bindgen]
pub fn wasi_get_process_id() -> u32 {
    std::process::id()
}

#[wasm_bindgen]
pub fn wasi_get_env_var(name: &str) -> Result<String, String> {
    match std::env::var(name) {
        Ok(value) => Ok(value),
        Err(_) => Err("Environment variable not found".to_string()),
    }
}

#[wasm_bindgen]
pub fn wasi_get_current_dir() -> Result<String, String> {
    match std::env::current_dir() {
        Ok(path) => Ok(path.to_string_lossy().to_string()),
        Err(e) => Err(format!("Failed to get current directory: {}", e)),
    }
}

// ============ Memory System Calls ============

#[wasm_bindgen]
pub fn wasi_get_memory_usage() -> u64 {
    // Simple memory usage (in bytes)
    std::mem::size_of::<u8>() as u64 * 1024 * 1024
}

#[wasm_bindgen]
pub fn wasi_allocate_memory(size: usize) -> Result<String, String> {
    // Allocate memory (for testing)
    let vec = vec![0u8; size];
    Ok(format!("Allocated {} bytes", vec.len()))
}