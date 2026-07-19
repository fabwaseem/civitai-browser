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
    /// Preferred on-disk filename (Comfy workflow name). Used to pick the exact
    /// file/version and as the saved destination name.
    pub preferred_file_name: Option<String>,
    /// Civitai file hash (AutoV1/V2/V3, SHA256, BLAKE3, CRC32)
    pub hash: Option<String>,
    pub kind: Option<String>,
    pub api_token: Option<String>,
    /// Hugging Face token for mirrors / gated repos
    pub hf_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedModelFile {
    pub model_id: Option<i64>,
    pub model_version_id: i64,
    pub model_name: String,
    pub version_name: String,
    /// Destination filename (often the workflow/Comfy name).
    pub file_name: String,
    /// Filename on the source (Civitai/HF) before any preferred rename.
    pub source_file_name: String,
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
    pub hf_token: Option<String>,
}

fn is_huggingface_url(url: &str) -> bool {
    url.contains("huggingface.co")
}

fn bearer_for_url<'a>(
    url: &str,
    civitai_token: Option<&'a str>,
    hf_token: Option<&'a str>,
) -> Option<&'a str> {
    if is_huggingface_url(url) {
        hf_token.filter(|t| !t.is_empty())
    } else if url.contains("civitai.com") {
        civitai_token.filter(|t| !t.is_empty())
    } else {
        None
    }
}

fn friendly_http_error(status: reqwest::StatusCode, body: &str, url: &str) -> String {
    let parsed: Option<serde_json::Value> = serde_json::from_str(body).ok();
    let api_message = parsed.as_ref().and_then(|v| {
        v.get("message")
            .or_else(|| v.get("error"))
            .and_then(|x| x.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && s != "Unauthorized" && s != "Error")
    });
    let is_hf = is_huggingface_url(url);
    let token_hint = if is_hf {
        "Add your Hugging Face token in Settings."
    } else {
        "Add your Civitai API token in Settings."
    };

    match status.as_u16() {
        401 => {
            let detail = api_message.unwrap_or_else(|| {
                "This file requires authentication.".into()
            });
            format!("{detail} {token_hint}")
        }
        403 => api_message.unwrap_or_else(|| {
            if is_hf {
                "Access denied. You may need a Hugging Face token or accept the repo license."
                    .into()
            } else {
                "Access denied. You may need a Civitai API token or early-access permission."
                    .into()
            }
        }),
        404 => api_message.unwrap_or_else(|| {
            if is_hf {
                "File not found on Hugging Face.".into()
            } else {
                "File not found on Civitai.".into()
            }
        }),
        429 => "Too many requests — wait a moment and try again.".into(),
        _ => api_message.unwrap_or_else(|| format!("Download failed (HTTP {status})")),
    }
}

fn friendly_api_error(status: reqwest::StatusCode, body: &str) -> String {
    friendly_http_error(status, body, "https://civitai.com/")
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

fn basename_only(name: &str) -> &str {
    Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(name)
}

fn file_stem_lower(name: &str) -> String {
    Path::new(basename_only(name))
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(name)
        .to_lowercase()
}

/// Alphanumeric-only key so spaces/underscores/dots don't break matching.
fn alnum_key(name: &str) -> String {
    file_stem_lower(name)
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect()
}

/// Drop training noise: epoch10, step1000 (digits already glued in alnum key).
fn strip_train_suffix(key: &str) -> String {
    let mut s = key.to_string();
    loop {
        let before = s.len();
        for prefix in ["epoch", "steps", "step"] {
            if let Some(i) = s.rfind(prefix) {
                let rest = &s[i + prefix.len()..];
                if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()) {
                    s.truncate(i);
                    break;
                }
            }
        }
        if s.len() == before {
            break;
        }
    }
    s
}

fn names_equivalent(a: &str, b: &str) -> bool {
    let a = basename_only(a);
    let b = basename_only(b);
    if a.eq_ignore_ascii_case(b) {
        return true;
    }
    if file_stem_lower(a) == file_stem_lower(b) {
        return true;
    }
    names_fuzzy_match(a, b)
}

/// Match workflow filenames to Civitai names across spaces/underscores/epoch suffixes.
/// e.g. KR2_Tiger_…_epoch_10 ≈ "KR2 Tiger Kittens Calliope.safetensors"
fn names_fuzzy_match(a: &str, b: &str) -> bool {
    let ka = strip_train_suffix(&alnum_key(a));
    let kb = strip_train_suffix(&alnum_key(b));
    if ka.is_empty() || kb.is_empty() {
        return false;
    }
    if ka == kb {
        return true;
    }
    let (short, long) = if ka.len() <= kb.len() {
        (ka.as_str(), kb.as_str())
    } else {
        (kb.as_str(), ka.as_str())
    };
    // Require a meaningful prefix to avoid weak hits like "vae"
    short.len() >= 10 && long.contains(short)
}

fn file_json_name(file: &serde_json::Value) -> Option<&str> {
    file.get("name").and_then(|v| v.as_str())
}

fn pick_file_for_version<'a>(
    files: &'a [serde_json::Value],
    preferred: Option<&str>,
) -> Option<&'a serde_json::Value> {
    if let Some(pref) = preferred.filter(|s| !s.trim().is_empty()) {
        if let Some(exact) = files.iter().find(|f| {
            file_json_name(f).is_some_and(|n| n.eq_ignore_ascii_case(basename_only(pref)))
        }) {
            return Some(exact);
        }
        if let Some(fuzzy) = files
            .iter()
            .find(|f| file_json_name(f).is_some_and(|n| names_equivalent(n, pref)))
        {
            return Some(fuzzy);
        }
    }
    files
        .iter()
        .find(|f| f.get("primary").and_then(|v| v.as_bool()) == Some(true))
        .or_else(|| files.first())
}

fn version_has_matching_file(version: &serde_json::Value, preferred: &str) -> bool {
    version
        .get("files")
        .and_then(|v| v.as_array())
        .into_iter()
        .flatten()
        .any(|f| file_json_name(f).is_some_and(|n| names_equivalent(n, preferred)))
}

fn version_name_matches(model: &serde_json::Value, version: &serde_json::Value, preferred: &str) -> bool {
    let model_name = model.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let ver_name = version.get("name").and_then(|v| v.as_str()).unwrap_or("");
    if names_fuzzy_match(preferred, model_name) {
        return true;
    }
    if !ver_name.is_empty() {
        let combined = format!("{model_name} {ver_name}");
        if names_fuzzy_match(preferred, &combined) || names_fuzzy_match(preferred, ver_name) {
            return true;
        }
    }
    false
}

fn find_version_matching_filename(
    versions: &[serde_json::Value],
    preferred: &str,
) -> Option<serde_json::Value> {
    let pref_base = basename_only(preferred);
    if let Some(v) = versions.iter().find(|version| {
        version
            .get("files")
            .and_then(|f| f.as_array())
            .into_iter()
            .flatten()
            .any(|f| file_json_name(f).is_some_and(|n| n.eq_ignore_ascii_case(pref_base)))
    }) {
        return Some(v.clone());
    }
    versions
        .iter()
        .find(|v| version_has_matching_file(v, preferred))
        .cloned()
}

fn find_best_version_for_preferred(
    model: &serde_json::Value,
    preferred: &str,
) -> Option<serde_json::Value> {
    let versions = model
        .get("modelVersions")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    if versions.is_empty() {
        return None;
    }
    if let Some(v) = find_version_matching_filename(&versions, preferred) {
        return Some(v);
    }
    if let Some(v) = versions
        .iter()
        .find(|v| version_name_matches(model, v, preferred))
    {
        return Some(v.clone());
    }
    // Single-version model whose name clearly matches the workflow file
    if versions.len() == 1 && version_name_matches(model, &versions[0], preferred) {
        return Some(versions[0].clone());
    }
    None
}

fn map_kind_to_civitai_type(kind: &str) -> Option<&'static str> {
    match kind {
        "checkpoint" | "diffusion" => Some("Checkpoint"),
        "lora" => Some("LORA"),
        "embedding" => Some("TextualInversion"),
        "vae" => Some("VAE"),
        "upscale" => Some("Upscaler"),
        _ => None,
    }
}

/// Well-known Comfy files that often live on HF instead of Civitai.
fn known_mirror_candidates(file_name: &str) -> Vec<(String, String)> {
    let key = basename_only(file_name).to_lowercase();
    let mut out: Vec<(String, String)> = Vec::new();
    let mut push = |url: &str, label: &str| {
        out.push((url.to_string(), label.to_string()));
    };

    match key.as_str() {
        "wan_2.1_vae.safetensors" | "wan2.1_vae.safetensors" | "wan21_vae.safetensors" => {
            push(
                "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/vae/wan_2.1_vae.safetensors",
                "Comfy-Org Wan 2.1 VAE",
            );
        }
        "wan_2.2_vae.safetensors" | "wan2.2_vae.safetensors" => {
            push(
                "https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/resolve/main/split_files/vae/wan2.2_vae.safetensors",
                "Comfy-Org Wan 2.2 VAE",
            );
        }
        "ae.safetensors" => {
            push(
                "https://huggingface.co/black-forest-labs/FLUX.1-dev/resolve/main/ae.safetensors",
                "FLUX.1 ae VAE",
            );
            push(
                "https://huggingface.co/Comfy-Org/flux1-dev/resolve/main/ae.safetensors",
                "Comfy-Org FLUX ae",
            );
        }
        "umt5_xxl_fp8_e4m3fn_scaled.safetensors" => {
            push(
                "https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged/resolve/main/split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors",
                "Comfy-Org umT5-XXL",
            );
        }
        "clip_l.safetensors" => {
            push(
                "https://huggingface.co/Comfy-Org/stable-diffusion-3.5-fp8/resolve/main/text_encoders/clip_l.safetensors",
                "Comfy-Org CLIP-L",
            );
        }
        // —— Upscalers (often .pth; many never listed as Civitai "models") ——
        "4x-ultrasharp.pth" | "4x_ultrasharp.pth" | "4x-ultrasharp.safetensors" => {
            push(
                "https://huggingface.co/lokCX/4x-Ultrasharp/resolve/main/4x-UltraSharp.pth",
                "4x-UltraSharp",
            );
            push(
                "https://huggingface.co/wangkanai/flux-upscale/resolve/main/upscale_models/4x-UltraSharp.pth",
                "4x-UltraSharp (flux-upscale)",
            );
        }
        "4x-animesharp.pth" | "4x_animesharp.pth" => {
            push(
                "https://huggingface.co/Kim2091/AnimeSharp/resolve/main/4x-AnimeSharp.pth",
                "4x-AnimeSharp",
            );
        }
        "realesrgan_x4plus.pth" | "realesrgan-x4plus.pth" => {
            push(
                "https://huggingface.co/ai-forever/Real-ESRGAN/resolve/main/RealESRGAN_x4.pth",
                "RealESRGAN x4",
            );
            push(
                "https://huggingface.co/wangkanai/flux-upscale/resolve/main/upscale_models/RealESRGAN_x4plus.pth",
                "RealESRGAN_x4plus",
            );
        }
        "realesrgan_x2plus.pth" | "realesrgan-x2plus.pth" => {
            push(
                "https://huggingface.co/wangkanai/flux-upscale/resolve/main/upscale_models/RealESRGAN_x2plus.pth",
                "RealESRGAN_x2plus",
            );
        }
        "realesrgan_x4plus_anime_6b.pth" | "realesrgan_x4plus_anime.pth" => {
            push(
                "https://huggingface.co/ai-forever/Real-ESRGAN/resolve/main/RealESRGAN_x4plus_anime_6B.pth",
                "RealESRGAN anime 6B",
            );
        }
        "4x_foolhardy_remacri.pth" | "4x-foolhardy-remacri.pth" => {
            push(
                "https://huggingface.co/FacehugmanIII/4x_foolhardy_Remacri/resolve/main/4x_foolhardy_Remacri.pth",
                "4x Remacri",
            );
        }
        _ => {}
    }
    out
}

#[derive(Debug, PartialEq, Eq)]
enum UrlProbe {
    Ok,
    NeedsAuth,
    Fail,
}

async fn probe_download_url(url: &str, token: Option<&str>) -> UrlProbe {
    let client = download_client();
    let auth = |mut req: reqwest::RequestBuilder| -> reqwest::RequestBuilder {
        if let Some(t) = token.filter(|t| !t.is_empty()) {
            req = req.bearer_auth(t);
        }
        req
    };

    // Prefer a tiny ranged GET — many HF endpoints mishandle HEAD.
    let ranged = auth(client.get(url)).header(reqwest::header::RANGE, "bytes=0-0");
    if let Ok(resp) = ranged.send().await {
        let status = resp.status();
        if status.is_success()
            || status == reqwest::StatusCode::PARTIAL_CONTENT
            || status.is_redirection()
        {
            return UrlProbe::Ok;
        }
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return if token.filter(|t| !t.is_empty()).is_some() {
                UrlProbe::Fail
            } else {
                UrlProbe::NeedsAuth
            };
        }
    }

    let head = auth(client.head(url));
    if let Ok(resp) = head.send().await {
        let status = resp.status();
        if status.is_success() || status.is_redirection() {
            return UrlProbe::Ok;
        }
        if status.as_u16() == 401 || status.as_u16() == 403 {
            return if token.filter(|t| !t.is_empty()).is_some() {
                UrlProbe::Fail
            } else {
                UrlProbe::NeedsAuth
            };
        }
    }
    UrlProbe::Fail
}

fn hf_resolved(file_name: &str, url: String, label: &str, size_kb: Option<f64>) -> ResolvedModelFile {
    let name = sanitize_filename(basename_only(file_name));
    ResolvedModelFile {
        model_id: None,
        model_version_id: 0,
        model_name: label.to_string(),
        version_name: "huggingface".into(),
        file_name: name.clone(),
        source_file_name: name,
        size_kb,
        download_url: url,
        air: None,
    }
}

fn tree_entry_matches_file(path: &str, want: &str) -> bool {
    let leaf = path.rsplit('/').next().unwrap_or(path);
    names_equivalent(leaf, want)
}

async fn try_known_hf_mirrors(
    file_name: &str,
    hf_token: Option<&str>,
) -> Option<ResolvedModelFile> {
    let want = basename_only(file_name);
    let token = hf_token.filter(|t| !t.is_empty());
    let mut needs_auth: Option<(String, String)> = None;

    for (url, label) in known_mirror_candidates(want) {
        match probe_download_url(&url, token).await {
            UrlProbe::Ok => return Some(hf_resolved(want, url, &label, None)),
            UrlProbe::NeedsAuth => {
                if needs_auth.is_none() {
                    needs_auth = Some((url, label));
                }
            }
            UrlProbe::Fail => {}
        }
    }

    needs_auth.map(|(url, label)| hf_resolved(want, url, &label, None))
}

/// Search Hugging Face Hub for a file by name (fallback when Civitai has nothing).
async fn search_huggingface_hub(
    file_name: &str,
    hf_token: Option<&str>,
    kind: Option<&str>,
) -> AppResult<ResolvedModelFile> {
    let want = basename_only(file_name);
    let token = hf_token.filter(|t| !t.is_empty());

    let queries = search_query_variants(want, kind);
    let query_limit = if kind == Some("upscale") { 6 } else { 4 };
    let mut last_error = format!("No Hugging Face mirror found for \"{want}\"");

    for query in queries.iter().take(query_limit) {
        let search_url = format!(
            "https://huggingface.co/api/models?limit=8&search={}",
            urlencoding_encode(query)
        );
        let search = match get_json(&search_url, token).await {
            Ok(v) => v,
            Err(e) => {
                last_error = e.to_string();
                continue;
            }
        };

        let repos: Vec<String> = if let Some(arr) = search.as_array() {
            arr.iter()
                .filter_map(|m| {
                    m.get("id")
                        .or_else(|| m.get("modelId"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
                .collect()
        } else {
            Vec::new()
        };

        if repos.is_empty() {
            last_error = format!("No Hugging Face repos for \"{query}\"");
            continue;
        }

        for repo in repos.iter().take(6) {
            let tree_url = format!(
                "https://huggingface.co/api/models/{}/tree/main?recursive=1",
                repo
            );
            let tree = match get_json(&tree_url, token).await {
                Ok(v) => v,
                Err(_) => continue,
            };
            let Some(entries) = tree.as_array() else {
                continue;
            };

            let mut fuzzy_hit: Option<(String, Option<f64>)> = None;
            for entry in entries {
                let path = match entry.get("path").and_then(|v| v.as_str()) {
                    Some(p) => p,
                    None => continue,
                };
                let is_file = entry
                    .get("type")
                    .and_then(|v| v.as_str())
                    .map(|t| t == "file")
                    .unwrap_or(true);
                if !is_file || !tree_entry_matches_file(path, want) {
                    continue;
                }
                let size_kb = entry
                    .get("size")
                    .and_then(|v| v.as_u64())
                    .map(|b| b as f64 / 1024.0);
                let encoded_path = path
                    .split('/')
                    .map(urlencoding_encode)
                    .collect::<Vec<_>>()
                    .join("/");
                let url = format!("https://huggingface.co/{repo}/resolve/main/{encoded_path}");
                let leaf = path.rsplit('/').next().unwrap_or(path);
                if leaf.eq_ignore_ascii_case(want) {
                    match probe_download_url(&url, token).await {
                        UrlProbe::Ok | UrlProbe::NeedsAuth => {
                            return Ok(hf_resolved(want, url, repo, size_kb));
                        }
                        UrlProbe::Fail => {}
                    }
                } else if fuzzy_hit.is_none() {
                    fuzzy_hit = Some((url, size_kb));
                }
            }
            if let Some((url, size_kb)) = fuzzy_hit {
                match probe_download_url(&url, token).await {
                    UrlProbe::Ok | UrlProbe::NeedsAuth => {
                        return Ok(hf_resolved(want, url, repo, size_kb));
                    }
                    UrlProbe::Fail => {}
                }
            }
        }
    }

    Err(AppError::Message(last_error))
}

fn search_query_variants(name: &str, kind: Option<&str>) -> Vec<String> {
    let base = basename_only(name);
    let stem = Path::new(base)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(base);
    let mut out = Vec::new();
    let mut push = |s: String| {
        let t = s.split_whitespace().collect::<Vec<_>>().join(" ");
        if t.len() >= 3 && !out.iter().any(|x: &String| x.eq_ignore_ascii_case(&t)) {
            out.push(t);
        }
    };

    push(stem.to_string());

    // Drop _epoch_N / -epoch-N for search
    let mut no_epoch = stem.to_string();
    if let Some(i) = no_epoch.to_lowercase().rfind("epoch") {
        no_epoch.truncate(i);
        no_epoch = no_epoch.trim_end_matches(['_', '-', '.']).to_string();
        push(no_epoch.clone());
    }

    push(stem.replace('_', " "));
    push(stem.replace(['_', '-', '.'], " "));

    // wan_2.1_vae → wan21 vae
    let glued = stem
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || c.is_ascii_whitespace())
        .collect::<String>();
    push(glued);

    // First meaningful tokens (helps "KR2 Tiger Kittens Calliope…")
    let spaced = stem.replace(['_', '-'], " ");
    let tokens: Vec<&str> = spaced.split_whitespace().collect();
    if tokens.len() >= 3 {
        push(tokens[..3].join(" "));
        push(tokens[..tokens.len().min(4)].join(" "));
    }

    if kind == Some("upscale") {
        push(format!("{stem} upscale"));
        push(format!("{stem} esrgan"));
        // Strip leading scale prefix for broader hits: 4x-UltraSharp → UltraSharp
        let no_scale = stem
            .trim_start_matches(|c: char| c.is_ascii_digit())
            .trim_start_matches(['x', 'X', '-', '_']);
        if no_scale.len() >= 3 && !no_scale.eq_ignore_ascii_case(stem) {
            push(no_scale.to_string());
            push(format!("{no_scale} upscale"));
        }
    }

    out
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

fn resolve_from_version_json(
    version: &serde_json::Value,
    preferred_file_name: Option<&str>,
) -> AppResult<ResolvedModelFile> {
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
    let file = pick_file_for_version(&files, preferred_file_name).ok_or_else(|| {
        AppError::Message("No downloadable files on this version".into())
    })?;

    let download_url = file
        .get("downloadUrl")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .or_else(|| version.get("downloadUrl").and_then(|v| v.as_str()))
        .ok_or_else(|| AppError::Message("File has no downloadUrl".into()))?
        .to_string();

    // Prefer workflow/Comfy filename so the file is findable by the graph.
    let source_file_name = file
        .get("name")
        .and_then(|v| v.as_str())
        .map(sanitize_filename)
        .unwrap_or_else(|| format!("model-version-{model_version_id}.safetensors"));

    let file_name = preferred_file_name
        .map(basename_only)
        .filter(|s| !s.trim().is_empty())
        .map(sanitize_filename)
        .filter(|s| {
            // Keep preferred only when it looks like a real model file, or
            // stems match the Civitai file (avoid saving as "version-123").
            has_model_extension(s) || names_equivalent(s, &source_file_name)
        })
        .unwrap_or_else(|| source_file_name.clone());

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
        source_file_name,
        size_kb,
        download_url,
        air,
    })
}

fn has_model_extension(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| {
            matches!(
                e.to_ascii_lowercase().as_str(),
                "safetensors" | "ckpt" | "pt" | "bin" | "pth"
            )
        })
}

fn inject_model_into_version(
    version: &serde_json::Value,
    model_id: i64,
    model: &serde_json::Value,
) -> serde_json::Value {
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
    version
}

pub async fn resolve_model_file(params: ResolveModelParams) -> AppResult<ResolvedModelFile> {
    let token = params.api_token.as_deref();
    let hf_token = params.hf_token.as_deref();
    let preferred = params
        .preferred_file_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            params
                .name
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty() && has_model_extension(s))
        });
    let preferred_owned = preferred.map(|s| s.to_string());
    let preferred_ref = preferred_owned.as_deref();

    // 1) Exact version id (from civitaiResources) — always preferred
    if let Some(version_id) = params.model_version_id {
        let url = format!("https://civitai.com/api/v1/model-versions/{version_id}");
        let version = get_json(&url, token).await?;
        return resolve_from_version_json(&version, preferred_ref);
    }

    // 2) Hash lookup — uniquely identifies the exact file/version
    if let Some(hash) = params
        .hash
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let url = format!(
            "https://civitai.com/api/v1/model-versions/by-hash/{}",
            urlencoding_encode(hash)
        );
        let version = get_json(&url, token).await?;
        return resolve_from_version_json(&version, preferred_ref);
    }

    // 3) Model id — pick the version that owns the workflow filename, not newest
    if let Some(model_id) = params.model_id {
        let url = format!("https://civitai.com/api/v1/models/{model_id}");
        let model = get_json(&url, token).await?;
        let preferred_for_model = preferred_ref.unwrap_or("");
        let version = if !preferred_for_model.is_empty() {
            find_best_version_for_preferred(&model, preferred_for_model)
        } else {
            let versions = model
                .get("modelVersions")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            if versions.len() == 1 {
                versions.into_iter().next()
            } else {
                None
            }
        }
        .ok_or_else(|| {
            if preferred_ref.is_some() {
                AppError::Message(format!(
                    "No version of this model matches \"{}\"",
                    basename_only(preferred_ref.unwrap_or(""))
                ))
            } else {
                AppError::Message(
                    "Multiple versions exist — need a filename or modelVersionId to pick the exact one"
                        .into(),
                )
            }
        })?;

        let version = inject_model_into_version(&version, model_id, &model);
        return resolve_from_version_json(&version, preferred_ref);
    }

    let name = params
        .name
        .as_deref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            AppError::Message(
                "Need modelVersionId, hash, modelId, or a name to resolve download".into(),
            )
        })?;

    let match_name = preferred_ref.unwrap_or(name);
    let kind = params.kind.as_deref();

    // 4) Known HF mirrors (official Comfy packs / popular upscalers)
    if let Some(resolved) = try_known_hf_mirrors(match_name, hf_token).await {
        return Ok(resolved);
    }

    // Upscalers often live only on HF — try hub search before a long Civitai crawl
    if kind == Some("upscale") {
        if let Ok(resolved) = search_huggingface_hub(match_name, hf_token, kind).await {
            return Ok(resolved);
        }
    }

    // 5) Search Civitai with multiple query shapes + fuzzy file/name matching
    let queries = search_query_variants(name, kind);
    let kind_type = kind.and_then(map_kind_to_civitai_type);
    let mut last_error = format!("No Civitai model found for \"{name}\"");

    for query in queries.iter() {
        // Try with type filter first, then without (many VAEs/upscalers aren't typed)
        let type_passes: &[Option<&str>] = match kind_type {
            Some(t) => &[Some(t), None],
            None => &[None],
        };

        for typed in type_passes {
            let mut url = format!(
                "https://civitai.com/api/v1/models?limit=10&query={}",
                urlencoding_encode(query)
            );
            if let Some(kind) = typed {
                url.push_str(&format!("&types={kind}"));
            }

            let search = match get_json(&url, token).await {
                Ok(v) => v,
                Err(e) => {
                    last_error = e.to_string();
                    continue;
                }
            };
            let items = search
                .get("items")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            if items.is_empty() {
                last_error = format!("No Civitai model found for \"{query}\"");
                continue;
            }

            for model in &items {
                let model_id = match model.get("id").and_then(|v| v.as_i64()) {
                    Some(id) => id,
                    None => continue,
                };
                if let Some(version) = find_best_version_for_preferred(model, match_name) {
                    let version = inject_model_into_version(&version, model_id, model);
                    return resolve_from_version_json(&version, Some(match_name));
                }
            }

            last_error = format!(
                "Found models for \"{query}\" but none match \"{}\"",
                basename_only(match_name)
            );
        }
    }

    // 6) Hugging Face Hub search fallback (skip if already tried for upscale)
    if kind == Some("upscale") {
        return Err(AppError::Message(format!(
            "{last_error}. No Hugging Face mirror found either."
        )));
    }
    match search_huggingface_hub(match_name, hf_token, kind).await {
        Ok(resolved) => Ok(resolved),
        Err(hf_err) => Err(AppError::Message(format!(
            "{last_error}. Hugging Face: {hf_err}"
        ))),
    }
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
    if let Some(token) = bearer_for_url(
        &params.url,
        params.api_token.as_deref(),
        params.hf_token.as_deref(),
    ) {
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
        let message = friendly_http_error(status, &body, &params.url);
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
