//! Resumable file downloads with progress events (IDM-style).

use crate::error::{AppError, AppResult};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const PROGRESS_EVERY: u64 = 256 * 1024; // bytes
const PROGRESS_INTERVAL: Duration = Duration::from_millis(200);

fn download_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("CivitaiBrowser/0.1.0")
            .pool_max_idle_per_host(8)
            .tcp_keepalive(Duration::from_secs(60))
            // Large model files — long read timeout (24h)
            .timeout(Duration::from_secs(24 * 60 * 60))
            .connect_timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .expect("failed to build download HTTP client")
    })
}

#[derive(Default)]
pub struct DownloadManager {
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    part_paths: Mutex<HashMap<String, PathBuf>>,
    discard_on_cancel: Mutex<HashSet<String>>,
}

impl DownloadManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, job_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut map) = self.cancels.lock() {
            map.insert(job_id.to_string(), Arc::clone(&flag));
        }
        flag
    }

    pub fn set_part_path(&self, job_id: &str, part_path: PathBuf) {
        if let Ok(mut map) = self.part_paths.lock() {
            map.insert(job_id.to_string(), part_path);
        }
    }

    /// Pause: discard=false (keep .part). Cancel/delete: discard=true.
    pub fn cancel(&self, job_id: &str, discard_partial: bool) -> bool {
        if let Ok(mut set) = self.discard_on_cancel.lock() {
            if discard_partial {
                set.insert(job_id.to_string());
            } else {
                set.remove(job_id);
            }
        }
        if let Ok(map) = self.cancels.lock() {
            if let Some(flag) = map.get(job_id) {
                flag.store(true, Ordering::SeqCst);
                return true;
            }
        }
        // Not actively downloading — delete part now if requested
        if discard_partial {
            let _ = self.delete_registered_part(job_id);
        }
        false
    }

    pub fn should_discard(&self, job_id: &str) -> bool {
        self.discard_on_cancel
            .lock()
            .map(|set| set.contains(job_id))
            .unwrap_or(false)
    }

    pub fn delete_registered_part(&self, job_id: &str) -> AppResult<bool> {
        let path = self
            .part_paths
            .lock()
            .ok()
            .and_then(|mut map| map.remove(job_id));
        if let Some(path) = path {
            if path.exists() {
                std::fs::remove_file(&path)?;
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub fn unregister(&self, job_id: &str) {
        if let Ok(mut map) = self.cancels.lock() {
            map.remove(job_id);
        }
        if let Ok(mut set) = self.discard_on_cancel.lock() {
            set.remove(job_id);
        }
        // keep part_paths until explicitly deleted / completed rename
        if let Ok(mut map) = self.part_paths.lock() {
            map.remove(job_id);
        }
    }
}

pub fn part_path_for_dest(dest: &Path) -> PathBuf {
    let mut p = dest.to_path_buf();
    let name = format!(
        "{}.part",
        dest.file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("download")
    );
    p.set_file_name(name);
    p
}

/// Delete `{dest}.part` next to a destination path (or the path itself if it ends with .part).
pub fn clear_download_partial(dest_path: &str) -> AppResult<bool> {
    let dest = PathBuf::from(dest_path);
    let part = if dest
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("part"))
    {
        dest
    } else {
        part_path_for_dest(&dest)
    };
    if part.exists() {
        std::fs::remove_file(&part)?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgressEvent {
    pub job_id: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub speed: f64,
    pub status: String,
    pub message: Option<String>,
    pub dest_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveModelParams {
    pub model_version_id: Option<i64>,
    pub model_id: Option<i64>,
    pub name: Option<String>,
    pub kind: Option<String>,
    pub api_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedModelFile {
    pub model_id: Option<i64>,
    pub model_version_id: i64,
    pub model_name: String,
    pub version_name: String,
    pub file_name: String,
    pub size_kb: Option<f64>,
    pub download_url: String,
    pub air: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartFileDownloadParams {
    pub job_id: String,
    pub url: String,
    pub dest_path: String,
    pub api_token: Option<String>,
}

fn friendly_http_error(status: reqwest::StatusCode, body: &str) -> String {
    let parsed: Option<serde_json::Value> = serde_json::from_str(body).ok();
    let api_message = parsed.as_ref().and_then(|v| {
        v.get("message")
            .or_else(|| v.get("error"))
            .and_then(|x| x.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && s != "Unauthorized" && s != "Error")
    });

    match status.as_u16() {
        401 => {
            let detail = api_message.unwrap_or_else(|| {
                "This file requires authentication.".into()
            });
            format!("{detail} Add your Civitai API token in Settings.")
        }
        403 => api_message.unwrap_or_else(|| {
            "Access denied. You may need a Civitai API token or early-access permission."
                .into()
        }),
        404 => api_message.unwrap_or_else(|| "File not found on Civitai.".into()),
        429 => "Too many requests — wait a moment and try again.".into(),
        _ => api_message.unwrap_or_else(|| format!("Download failed (HTTP {status})")),
    }
}

fn friendly_api_error(status: reqwest::StatusCode, body: &str) -> String {
    friendly_http_error(status, body)
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() {
        "download.bin".into()
    } else {
        trimmed.to_string()
    }
}

fn pick_primary_file(files: &[serde_json::Value]) -> Option<&serde_json::Value> {
    files
        .iter()
        .find(|f| f.get("primary").and_then(|v| v.as_bool()) == Some(true))
        .or_else(|| files.first())
}

fn map_kind_to_civitai_type(kind: &str) -> Option<&'static str> {
    match kind {
        "checkpoint" => Some("Checkpoint"),
        "lora" => Some("LORA"),
        "embedding" => Some("TextualInversion"),
        "vae" => Some("VAE"),
        _ => None,
    }
}

async fn get_json(
    url: &str,
    api_token: Option<&str>,
) -> AppResult<serde_json::Value> {
    let client = download_client();
    let mut request = client.get(url);
    if let Some(token) = api_token.filter(|t| !t.is_empty()) {
        request = request.bearer_auth(token);
    }
    let response = request.send().await?;
    let status = response.status();
    let body = response.text().await?;
    if !status.is_success() {
        return Err(AppError::Message(friendly_api_error(status, &body)));
    }
    Ok(serde_json::from_str(&body)?)
}

fn resolve_from_version_json(version: &serde_json::Value) -> AppResult<ResolvedModelFile> {
    let model_version_id = version
        .get("id")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| AppError::Message("Model version missing id".into()))?;

    let model = version.get("model").cloned().unwrap_or(serde_json::json!({}));
    let model_id = version
        .get("modelId")
        .and_then(|v| v.as_i64())
        .or_else(|| model.get("id").and_then(|v| v.as_i64()));
    let model_name = model
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown model")
        .to_string();
    let version_name = version
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let files = version
        .get("files")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let file = pick_primary_file(&files)
        .ok_or_else(|| AppError::Message("No downloadable files on this version".into()))?;

    let download_url = file
        .get("downloadUrl")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Message("File has no downloadUrl".into()))?
        .to_string();

    let file_name = file
        .get("name")
        .and_then(|v| v.as_str())
        .map(sanitize_filename)
        .unwrap_or_else(|| format!("model-version-{model_version_id}.safetensors"));

    let size_kb = file.get("sizeKB").and_then(|v| v.as_f64());
    let air = version
        .get("air")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(ResolvedModelFile {
        model_id,
        model_version_id,
        model_name,
        version_name,
        file_name,
        size_kb,
        download_url,
        air,
    })
}

pub async fn resolve_model_file(params: ResolveModelParams) -> AppResult<ResolvedModelFile> {
    let token = params.api_token.as_deref();

    if let Some(version_id) = params.model_version_id {
        let url = format!("https://civitai.com/api/v1/model-versions/{version_id}");
        let version = get_json(&url, token).await?;
        return resolve_from_version_json(&version);
    }

    if let Some(model_id) = params.model_id {
        let url = format!("https://civitai.com/api/v1/models/{model_id}");
        let model = get_json(&url, token).await?;
        let versions = model
            .get("modelVersions")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let version = versions
            .first()
            .ok_or_else(|| AppError::Message("Model has no versions".into()))?;
        // API nest may omit model object — inject name/id
        let mut version = version.clone();
        if let Some(obj) = version.as_object_mut() {
            if !obj.contains_key("model") {
                obj.insert(
                    "model".into(),
                    serde_json::json!({
                        "id": model_id,
                        "name": model.get("name").cloned().unwrap_or(serde_json::Value::Null),
                    }),
                );
            }
            if !obj.contains_key("modelId") {
                obj.insert("modelId".into(), serde_json::json!(model_id));
            }
        }
        return resolve_from_version_json(&version);
    }

    // Search by name when IDs are missing (Comfy filename-only resources)
    let name = params
        .name
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::Message(
                "Need modelVersionId, modelId, or a name to resolve download".into(),
            )
        })?;

    // Strip extension for search
    let query = Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(name);

    let mut url = format!(
        "https://civitai.com/api/v1/models?limit=5&query={}",
        urlencoding_encode(query)
    );
    if let Some(kind) = params.kind.as_deref().and_then(map_kind_to_civitai_type) {
        url.push_str(&format!("&types={kind}"));
    }

    let search = get_json(&url, token).await?;
    let items = search
        .get("items")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let model = items.first().ok_or_else(|| {
        AppError::Message(format!("No Civitai model found for \"{query}\""))
    })?;
    let model_id = model
        .get("id")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| AppError::Message("Search result missing model id".into()))?;

    // Recurse with model id
    Box::pin(resolve_model_file(ResolveModelParams {
        model_version_id: None,
        model_id: Some(model_id),
        name: None,
        kind: params.kind,
        api_token: params.api_token,
    }))
    .await
}

fn urlencoding_encode(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

fn emit_progress(app: &AppHandle, event: DownloadProgressEvent) {
    let _ = app.emit("download-progress", event);
}

fn filename_from_headers(headers: &reqwest::header::HeaderMap) -> Option<String> {
    let cd = headers.get(reqwest::header::CONTENT_DISPOSITION)?.to_str().ok()?;
    // filename="..." or filename*=UTF-8''...
    if let Some(idx) = cd.find("filename*=UTF-8''").or_else(|| cd.find("filename*=utf-8''")) {
        let rest = &cd[idx..];
        let value = rest.split("''").nth(1)?.split(';').next()?.trim();
        let decoded = urlencoding_decode(value);
        return Some(sanitize_filename(&decoded));
    }
    if let Some(idx) = cd.to_lowercase().find("filename=") {
        let mut value = cd[idx + "filename=".len()..].trim();
        if let Some(end) = value.find(';') {
            value = &value[..end];
        }
        value = value.trim().trim_matches('"');
        if !value.is_empty() {
            return Some(sanitize_filename(value));
        }
    }
    None
}

fn urlencoding_decode(s: &str) -> String {
    percent_decode(s)
}

fn percent_decode(s: &str) -> String {
    let bytes: Vec<u8> = {
        let mut out = Vec::new();
        let b = s.as_bytes();
        let mut i = 0;
        while i < b.len() {
            if b[i] == b'%' && i + 2 < b.len() {
                if let (Some(h), Some(l)) = (from_hex(b[i + 1]), from_hex(b[i + 2])) {
                    out.push((h << 4) | l);
                    i += 3;
                    continue;
                }
            }
            out.push(b[i]);
            i += 1;
        }
        out
    };
    String::from_utf8_lossy(&bytes).into_owned()
}

fn from_hex(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

pub async fn start_file_download(
    app: AppHandle,
    manager: &DownloadManager,
    params: StartFileDownloadParams,
) -> AppResult<String> {
    let job_id = params.job_id.clone();
    let cancel = manager.register(&job_id);
    let result = download_inner(&app, manager, &cancel, params).await;
    manager.unregister(&job_id);
    result
}

async fn download_inner(
    app: &AppHandle,
    manager: &DownloadManager,
    cancel: &AtomicBool,
    params: StartFileDownloadParams,
) -> AppResult<String> {
    let dest = PathBuf::from(&params.dest_path);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let part_path = part_path_for_dest(&dest);
    manager.set_part_path(&params.job_id, part_path.clone());

    // Already complete?
    if dest.exists() {
        let meta = std::fs::metadata(&dest)?;
        emit_progress(
            app,
            DownloadProgressEvent {
                job_id: params.job_id.clone(),
                downloaded: meta.len(),
                total: Some(meta.len()),
                speed: 0.0,
                status: "completed".into(),
                message: Some("Already downloaded".into()),
                dest_path: Some(dest.to_string_lossy().into()),
            },
        );
        return Ok(dest.to_string_lossy().into());
    }

    let existing = if part_path.exists() {
        std::fs::metadata(&part_path)?.len()
    } else {
        0
    };

    let client = download_client();
    let mut request = client.get(&params.url);
    if let Some(token) = params.api_token.as_deref().filter(|t| !t.is_empty()) {
        request = request.bearer_auth(token);
    }
    if existing > 0 {
        request = request.header(
            reqwest::header::RANGE,
            format!("bytes={existing}-"),
        );
    }

    emit_progress(
        app,
        DownloadProgressEvent {
            job_id: params.job_id.clone(),
            downloaded: existing,
            total: None,
            speed: 0.0,
            status: "downloading".into(),
            message: if existing > 0 {
                Some(format!("Resuming from {existing} bytes"))
            } else {
                None
            },
            dest_path: Some(dest.to_string_lossy().into()),
        },
    );

    let response = request.send().await?;
    let status = response.status();

    // If resume rejected, restart
    let (mut downloaded, append) = if existing > 0 && status == reqwest::StatusCode::OK {
        let _ = std::fs::remove_file(&part_path);
        (0u64, false)
    } else if existing > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT {
        (existing, true)
    } else if status.is_success() {
        (0u64, false)
    } else {
        let body = response.text().await.unwrap_or_default();
        let message = friendly_http_error(status, &body);
        emit_progress(
            app,
            DownloadProgressEvent {
                job_id: params.job_id.clone(),
                downloaded: existing,
                total: None,
                speed: 0.0,
                status: "failed".into(),
                message: Some(message.clone()),
                dest_path: None,
            },
        );
        return Err(AppError::Message(message));
    };

    // Content-Length / Content-Range total
    let total: Option<u64> = if status == reqwest::StatusCode::PARTIAL_CONTENT {
        response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.split('/').nth(1))
            .and_then(|s| s.parse().ok())
    } else {
        response.content_length().map(|len| len + downloaded)
    };

    // Prefer server filename if dest has generic name — keep dest as provided by frontend
    let _ = filename_from_headers(response.headers());

    let mut file = if append {
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&part_path)?
    } else {
        std::fs::File::create(&part_path)?
    };

    let mut stream = response.bytes_stream();
    let mut last_emit = Instant::now();
    let mut last_bytes = downloaded;
    let mut since_emit = 0u64;
    let start = Instant::now();

    use std::io::Write;

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            drop(file);
            let discard = manager.should_discard(&params.job_id);
            if discard {
                let _ = std::fs::remove_file(&part_path);
            }
            emit_progress(
                app,
                DownloadProgressEvent {
                    job_id: params.job_id.clone(),
                    downloaded,
                    total,
                    speed: 0.0,
                    status: "cancelled".into(),
                    message: None,
                    dest_path: Some(if discard {
                        dest.to_string_lossy().into()
                    } else {
                        part_path.to_string_lossy().into()
                    }),
                },
            );
            return Err(AppError::Message("CANCELLED".into()));
        }

        let chunk = chunk?;
        file.write_all(&chunk)?;
        let n = chunk.len() as u64;
        downloaded += n;
        since_emit += n;

        if since_emit >= PROGRESS_EVERY || last_emit.elapsed() >= PROGRESS_INTERVAL {
            let elapsed = last_emit.elapsed().as_secs_f64().max(0.001);
            let speed = (downloaded - last_bytes) as f64 / elapsed;
            emit_progress(
                app,
                DownloadProgressEvent {
                    job_id: params.job_id.clone(),
                    downloaded,
                    total,
                    speed,
                    status: "downloading".into(),
                    message: None,
                    dest_path: Some(dest.to_string_lossy().into()),
                },
            );
            last_emit = Instant::now();
            last_bytes = downloaded;
            since_emit = 0;
        }
    }

    file.flush()?;
    drop(file);

    // Atomic-ish finalize
    if dest.exists() {
        let _ = std::fs::remove_file(&dest);
    }
    std::fs::rename(&part_path, &dest)?;

    let avg_speed = downloaded as f64 / start.elapsed().as_secs_f64().max(0.001);
    emit_progress(
        app,
        DownloadProgressEvent {
            job_id: params.job_id.clone(),
            downloaded,
            total: Some(downloaded),
            speed: avg_speed,
            status: "completed".into(),
            message: None,
            dest_path: Some(dest.to_string_lossy().into()),
        },
    );

    Ok(dest.to_string_lossy().into())
}
