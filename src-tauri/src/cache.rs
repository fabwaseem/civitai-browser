use crate::civitai::download_file;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheImageParams {
    pub image_id: i64,
    pub url: String,
    pub api_token: Option<String>,
    pub preferred_ext: Option<String>,
    /// Optional ComfyUI workflow JSON to embed when the source is not already a PNG.
    pub workflow_json: Option<String>,
    pub prompt_json: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveImageParams {
    pub image_id: i64,
    pub url: String,
    pub destination_dir: String,
    pub api_token: Option<String>,
    pub preferred_ext: Option<String>,
    pub workflow_json: Option<String>,
    pub prompt_json: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedImage {
    pub path: String,
    pub from_cache: bool,
    pub format: String,
}

fn sniff_ext(bytes: &[u8], content_type: Option<&str>) -> String {
    if bytes.len() >= 8 && bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return "png".into();
    }
    if bytes.len() >= 3 && bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return "jpg".into();
    }
    if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return "webp".into();
    }
    if bytes.len() >= 6 && (bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")) {
        return "gif".into();
    }

    match content_type.map(|s| s.to_ascii_lowercase()).as_deref() {
        Some("image/png") => "png".into(),
        Some("image/jpeg") | Some("image/jpg") => "jpg".into(),
        Some("image/webp") => "webp".into(),
        Some("image/gif") => "gif".into(),
        // Civitai often mislabels original PNG as text/plain
        _ => "bin".into(),
    }
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for &b in data {
        crc ^= u32::from(b);
        for _ in 0..8 {
            let mask = (!(crc & 1)).wrapping_add(1);
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

/// Insert or replace a PNG tEXt chunk before IEND. Leaves pixel data untouched.
fn png_set_text_chunk(png: &[u8], key: &str, value: &str) -> AppResult<Vec<u8>> {
    if !png.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        return Err(AppError::Message("Not a PNG".into()));
    }
    if key.bytes().any(|b| b > 0x7F) || key.is_empty() || key.len() > 79 {
        return Err(AppError::Message("Invalid PNG text key".into()));
    }

    let mut out = Vec::with_capacity(png.len() + key.len() + value.len() + 32);
    out.extend_from_slice(&png[..8]);

    let mut i = 8usize;
    while i + 8 <= png.len() {
        let len = u32::from_be_bytes(png[i..i + 4].try_into().unwrap()) as usize;
        let chunk_type = &png[i + 4..i + 8];
        let total = 12 + len;
        if i + total > png.len() {
            break;
        }

        if chunk_type == b"IEND" {
            // write our text chunk, then IEND
            let mut data = Vec::with_capacity(key.len() + 1 + value.len());
            data.extend_from_slice(key.as_bytes());
            data.push(0);
            data.extend_from_slice(value.as_bytes());

            let mut type_and_data = Vec::with_capacity(4 + data.len());
            type_and_data.extend_from_slice(b"tEXt");
            type_and_data.extend_from_slice(&data);
            let crc = crc32(&type_and_data);

            out.extend_from_slice(&(data.len() as u32).to_be_bytes());
            out.extend_from_slice(&type_and_data);
            out.extend_from_slice(&crc.to_be_bytes());
            out.extend_from_slice(&png[i..i + total]);
            return Ok(out);
        }

        // drop existing tEXt/iTXt/zTXt with same key so we replace cleanly
        let skip = if chunk_type == b"tEXt" || chunk_type == b"iTXt" || chunk_type == b"zTXt" {
            let data = &png[i + 8..i + 8 + len];
            let existing_key = data.split(|b| *b == 0).next().unwrap_or(&[]);
            existing_key == key.as_bytes()
        } else {
            false
        };

        if !skip {
            out.extend_from_slice(&png[i..i + total]);
        }
        i += total;
    }

    Err(AppError::Message("PNG missing IEND chunk".into()))
}

fn ensure_comfy_png(
    bytes: &[u8],
    sniffed: &str,
    workflow_json: Option<&str>,
    prompt_json: Option<&str>,
) -> AppResult<(Vec<u8>, String)> {
    let mut png_bytes = if sniffed == "png" {
        bytes.to_vec()
    } else {
        // Re-encode non-PNG so ComfyUI can accept a .png drag target.
        // Pixel re-encode won't preserve source metadata; we re-inject below.
        let img = image::load_from_memory(bytes)
            .map_err(|e| AppError::Message(format!("Failed to decode image: {e}")))?;
        let mut encoded = Vec::new();
        let encoder = image::codecs::png::PngEncoder::new(&mut encoded);
        img.write_with_encoder(encoder)
            .map_err(|e| AppError::Message(format!("Failed to encode PNG: {e}")))?;
        encoded
    };

    if let Some(workflow) = workflow_json.filter(|s| !s.trim().is_empty()) {
        png_bytes = png_set_text_chunk(&png_bytes, "workflow", workflow)?;
    }
    if let Some(prompt) = prompt_json.filter(|s| !s.trim().is_empty()) {
        png_bytes = png_set_text_chunk(&png_bytes, "prompt", prompt)?;
    }

    Ok((png_bytes, "png".into()))
}

pub fn cache_dir(app: &AppHandle) -> AppResult<PathBuf> {
    // v3: correct Comfy detection embeds meta.comfy graphs (not txt2img labels)
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::Message(e.to_string()))?
        .join("originals-v3");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Fixed pixel size for OS drag ghost icons (always square).
const DRAG_ICON_SIZE: u32 = 96;

pub fn preview_dir(app: &AppHandle) -> AppResult<PathBuf> {
    // v3: always 96×96 PNG drag icons (v2 stored variable CDN sizes)
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::Message(e.to_string()))?
        .join("previews-v3");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn make_fixed_drag_icon(bytes: &[u8]) -> AppResult<Vec<u8>> {
    let img = image::load_from_memory(bytes)
        .map_err(|e| AppError::Message(format!("Failed to decode drag preview: {e}")))?;
    let icon = img.resize_to_fill(
        DRAG_ICON_SIZE,
        DRAG_ICON_SIZE,
        image::imageops::FilterType::Triangle,
    );
    let mut encoded = Vec::new();
    {
        let mut cursor = std::io::Cursor::new(&mut encoded);
        icon.write_to(&mut cursor, image::ImageFormat::Png)
            .map_err(|e| AppError::Message(format!("Failed to encode drag preview: {e}")))?;
    }
    Ok(encoded)
}

fn drag_icon_path(app: &AppHandle, image_id: i64) -> AppResult<PathBuf> {
    Ok(preview_dir(app)?.join(format!("{image_id}.png")))
}

/// Write/replace the fixed-size drag ghost for `image_id` from raw image bytes.
fn ensure_drag_icon_bytes(app: &AppHandle, image_id: i64, bytes: &[u8]) -> AppResult<PathBuf> {
    let path = drag_icon_path(app, image_id)?;
    if path.exists() {
        return Ok(path);
    }
    let icon_bytes = make_fixed_drag_icon(bytes)?;
    std::fs::write(&path, icon_bytes)?;
    Ok(path)
}

/// Remove cached originals and drag previews. Recreates empty dirs.
pub fn clear_image_cache(app: &AppHandle) -> AppResult<u64> {
    let mut removed = 0u64;
    for dir in [cache_dir(app)?, preview_dir(app)?] {
        if dir.exists() {
            for entry in std::fs::read_dir(&dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.is_file() {
                    std::fs::remove_file(&path)?;
                    removed += 1;
                } else if path.is_dir() {
                    std::fs::remove_dir_all(&path)?;
                    removed += 1;
                }
            }
        }
        std::fs::create_dir_all(&dir)?;
    }
    Ok(removed)
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewImageParams {
    pub image_id: i64,
    pub url: String,
    pub api_token: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DragReadyPaths {
    pub image_id: i64,
    pub original: String,
    pub preview: String,
}

/// Fast disk lookup — no network. Returns only images that already have
/// both the original file and the fixed drag icon on disk.
pub fn lookup_drag_ready(app: &AppHandle, image_ids: &[i64]) -> AppResult<Vec<DragReadyPaths>> {
    let originals = cache_dir(app)?;
    let mut out = Vec::new();
    for &image_id in image_ids {
        let Some(original) = find_existing_cache(&originals, image_id) else {
            continue;
        };
        let preview = drag_icon_path(app, image_id)?;
        if !preview.exists() {
            continue;
        }
        out.push(DragReadyPaths {
            image_id,
            original: original.to_string_lossy().into_owned(),
            preview: preview.to_string_lossy().into_owned(),
        });
    }
    Ok(out)
}

/// Download/cache original + fixed drag icon in one call.
pub async fn ensure_drag_ready(
    app: &AppHandle,
    params: CacheImageParams,
) -> AppResult<DragReadyPaths> {
    let original = ensure_cached_image(app, params.clone()).await?;
    let preview_path = drag_icon_path(app, params.image_id)?;
    if !preview_path.exists() {
        let bytes = std::fs::read(&original.path)?;
        ensure_drag_icon_bytes(app, params.image_id, &bytes)?;
    }
    Ok(DragReadyPaths {
        image_id: params.image_id,
        original: original.path,
        preview: preview_path.to_string_lossy().into_owned(),
    })
}

/// Fixed-size square PNG used only as the OS drag ghost icon.
pub async fn ensure_preview_image(
    app: &AppHandle,
    params: PreviewImageParams,
) -> AppResult<CachedImage> {
    let path = drag_icon_path(app, params.image_id)?;
    if path.exists() {
        return Ok(CachedImage {
            path: path.to_string_lossy().into_owned(),
            from_cache: true,
            format: "png".into(),
        });
    }

    // Prefer building the icon from an already-cached original (no extra download).
    if let Ok(dir) = cache_dir(app) {
        if let Some(existing) = find_existing_cache(&dir, params.image_id) {
            let bytes = std::fs::read(&existing)?;
            let icon_path = ensure_drag_icon_bytes(app, params.image_id, &bytes)?;
            return Ok(CachedImage {
                path: icon_path.to_string_lossy().into_owned(),
                from_cache: false,
                format: "png".into(),
            });
        }
    }

    let downloaded = download_file(&params.url, params.api_token.as_deref()).await?;
    let icon_path = ensure_drag_icon_bytes(app, params.image_id, &downloaded.bytes)?;

    Ok(CachedImage {
        path: icon_path.to_string_lossy().into_owned(),
        from_cache: false,
        format: "png".into(),
    })
}

fn find_existing_cache(dir: &Path, image_id: i64) -> Option<PathBuf> {
    for ext in ["png", "jpg", "jpeg", "webp", "gif"] {
        let path = dir.join(format!("{image_id}.{ext}"));
        if path.exists() {
            return Some(path);
        }
    }
    None
}

pub async fn ensure_cached_image(
    app: &AppHandle,
    params: CacheImageParams,
) -> AppResult<CachedImage> {
    let dir = cache_dir(app)?;

    // Prefer an already-correct PNG cache hit
    let png_path = dir.join(format!("{}.png", params.image_id));
    if png_path.exists() {
        let icon = drag_icon_path(app, params.image_id)?;
        if !icon.exists() {
            if let Ok(bytes) = std::fs::read(&png_path) {
                let _ = ensure_drag_icon_bytes(app, params.image_id, &bytes);
            }
        }
        return Ok(CachedImage {
            path: png_path.to_string_lossy().into_owned(),
            from_cache: true,
            format: "png".into(),
        });
    }

    if let Some(existing) = find_existing_cache(&dir, params.image_id) {
        // If we have a non-PNG but need Comfy workflow embedding, rebuild.
        let needs_png = params.workflow_json.as_ref().is_some_and(|s| !s.is_empty())
            || params.prompt_json.as_ref().is_some_and(|s| !s.is_empty());
        let ext = existing
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !(needs_png && ext != "png") {
            let icon = drag_icon_path(app, params.image_id)?;
            if !icon.exists() {
                if let Ok(bytes) = std::fs::read(&existing) {
                    let _ = ensure_drag_icon_bytes(app, params.image_id, &bytes);
                }
            }
            return Ok(CachedImage {
                path: existing.to_string_lossy().into_owned(),
                from_cache: true,
                format: ext,
            });
        }
    }

    let downloaded = download_file(&params.url, params.api_token.as_deref()).await?;
    let sniffed = sniff_ext(&downloaded.bytes, downloaded.content_type.as_deref());

    let wants_comfy = params
        .workflow_json
        .as_ref()
        .is_some_and(|s| !s.trim().is_empty())
        || params
            .prompt_json
            .as_ref()
            .is_some_and(|s| !s.trim().is_empty());

    let (bytes, ext) = if sniffed == "png" || wants_comfy {
        // Always materialize a real .png for Comfy drag when we can.
        // For plain PNG downloads with no extra meta, keep bytes as-is (preserves
        // any embedded workflow already in the file).
        if wants_comfy {
            ensure_comfy_png(
                &downloaded.bytes,
                &sniffed,
                params.workflow_json.as_deref(),
                params.prompt_json.as_deref(),
            )?
        } else if sniffed == "png" {
            (downloaded.bytes, "png".into())
        } else {
            (downloaded.bytes, sniffed)
        }
    } else {
        let ext = params
            .preferred_ext
            .as_deref()
            .map(|e| e.trim_start_matches('.').to_ascii_lowercase())
            .filter(|e| matches!(e.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif"))
            .unwrap_or(sniffed);
        (downloaded.bytes, ext)
    };

    let path = dir.join(format!("{}.{}", params.image_id, ext));
    // Remove stale wrong-extension siblings
    for stale_ext in ["png", "jpg", "jpeg", "webp", "gif", "bin"] {
        let stale = dir.join(format!("{}.{}", params.image_id, stale_ext));
        if stale != path && stale.exists() {
            let _ = std::fs::remove_file(stale);
        }
    }
    std::fs::write(&path, &bytes)?;
    // Same download → fixed drag ghost (no second network request)
    let _ = ensure_drag_icon_bytes(app, params.image_id, &bytes);

    Ok(CachedImage {
        path: path.to_string_lossy().into_owned(),
        from_cache: false,
        format: ext,
    })
}

pub async fn save_image_to_dir(app: &AppHandle, params: SaveImageParams) -> AppResult<String> {
    let cached = ensure_cached_image(
        app,
        CacheImageParams {
            image_id: params.image_id,
            url: params.url.clone(),
            api_token: params.api_token.clone(),
            preferred_ext: params.preferred_ext.clone(),
            workflow_json: params.workflow_json.clone(),
            prompt_json: params.prompt_json.clone(),
        },
    )
    .await?;

    let src = PathBuf::from(&cached.path);
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_string();

    let dest_dir = PathBuf::from(&params.destination_dir);
    std::fs::create_dir_all(&dest_dir)?;
    let dest = dest_dir.join(format!("civitai-{}.{}", params.image_id, ext));
    std::fs::copy(&src, &dest)?;

    Ok(dest.to_string_lossy().into_owned())
}

pub fn open_path(path: String) -> AppResult<()> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(AppError::Message(format!("Path does not exist: {path}")));
    }

    if target.is_file() {
        std::process::Command::new("explorer")
            .args(["/select,", &target.to_string_lossy()])
            .spawn()?;
    } else {
        std::process::Command::new("explorer")
            .arg(&target)
            .spawn()?;
    }

    Ok(())
}
