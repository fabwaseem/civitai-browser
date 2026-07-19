use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Typical ComfyUI `models/` subfolders we route downloads into.
pub const COMFY_SUBDIRS: &[&str] = &[
    "checkpoints",
    "loras",
    "vae",
    "embeddings",
    "controlnet",
    "clip",
    "text_encoders",
    "clip_vision",
    "unet",
    "diffusion_models",
    "upscale_models",
    "hypernetworks",
];

/// Where ComfyUI looks for each resource kind (download primary = first entry).
fn search_subdirs_for_kind(kind: &str) -> &'static [&'static str] {
    match kind {
        "checkpoint" => &["checkpoints"],
        "diffusion" => &["diffusion_models", "unet"],
        "clip" => &["text_encoders", "clip"],
        "lora" => &["loras"],
        "embedding" => &["embeddings"],
        "vae" => &["vae"],
        "upscale" => &["upscale_models"],
        // Main model files may live in any of these — check all when kind unknown
        _ => &[
            "checkpoints",
            "diffusion_models",
            "unet",
            "loras",
            "vae",
            "embeddings",
            "text_encoders",
            "clip",
            "upscale_models",
        ],
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComfyModelsDirInfo {
    pub path: String,
    pub valid: bool,
    pub reason: String,
    pub found: Vec<String>,
    pub missing_common: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindLocalModelParams {
    /// ComfyUI `models/` root
    pub root: String,
    /// Filename as referenced by the workflow (basename)
    pub file_name: String,
    /// Resource kind — narrows which subfolders to search
    pub kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindLocalModelResult {
    pub found: bool,
    pub path: Option<String>,
    /// Path relative to the models root, e.g. `diffusion_models/foo.safetensors`
    pub relative: Option<String>,
}

fn list_subdirs(path: &Path) -> AppResult<Vec<String>> {
    let mut names = Vec::new();
    if !path.is_dir() {
        return Err(AppError::Message("Path is not a folder".into()));
    }
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            if let Some(name) = entry.file_name().to_str() {
                names.push(name.to_string());
            }
        }
    }
    names.sort_by_key(|s| s.to_lowercase());
    Ok(names)
}

pub fn inspect_comfy_models_dir(path: String) -> AppResult<ComfyModelsDirInfo> {
    let root = PathBuf::from(path.trim());
    if !root.exists() {
        return Ok(ComfyModelsDirInfo {
            path: root.to_string_lossy().into(),
            valid: false,
            reason: "Folder does not exist".into(),
            found: vec![],
            missing_common: COMFY_SUBDIRS.iter().map(|s| (*s).to_string()).collect(),
        });
    }

    let subdirs = list_subdirs(&root)?;
    let lower: Vec<String> = subdirs.iter().map(|s| s.to_lowercase()).collect();

    let found: Vec<String> = COMFY_SUBDIRS
        .iter()
        .filter(|name| lower.iter().any(|d| d == **name))
        .map(|s| (*s).to_string())
        .collect();

    let missing_common: Vec<String> = ["checkpoints", "loras", "vae"]
        .iter()
        .filter(|name| !lower.iter().any(|d| d == **name))
        .map(|s| (*s).to_string())
        .collect();

    let folder_name = root
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    let named_models = folder_name == "models";
    let valid = named_models
        || found.len() >= 2
        || found
            .iter()
            .any(|f| f == "checkpoints" || f == "diffusion_models");

    let reason = if valid {
        if found.is_empty() {
            "Accepted as ComfyUI models folder (will create subfolders as needed)".into()
        } else {
            format!(
                "Looks like a ComfyUI models folder (found: {})",
                found.join(", ")
            )
        }
    } else {
        "Doesn't look like a ComfyUI models folder — pick the folder that contains checkpoints/, diffusion_models/, loras/, vae/".into()
    };

    Ok(ComfyModelsDirInfo {
        path: root.to_string_lossy().into(),
        valid,
        reason,
        found,
        missing_common,
    })
}

fn basename_ci(name: &str) -> String {
    Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(name)
        .to_lowercase()
}

fn stem_ci(name: &str) -> String {
    Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(name)
        .to_lowercase()
}

fn is_model_weight_file(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| {
            matches!(
                e.to_ascii_lowercase().as_str(),
                "safetensors" | "ckpt" | "pt" | "bin" | "pth" | "gguf"
            )
        })
}

/// Recursively search for a model weight file. Never matches previews (.jpeg/.png/…).
/// Prefers an exact basename match; falls back to stem match among weight files only.
fn find_in_tree(dir: &Path, target_base: &str, target_stem: &str, depth: usize) -> Option<PathBuf> {
    if depth > 6 || !dir.is_dir() {
        return None;
    }

    let mut exact: Option<PathBuf> = None;
    let mut stem_hit: Option<PathBuf> = None;
    let mut subdirs = Vec::new();

    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        let ft = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if ft.is_dir() {
            subdirs.push(path);
            continue;
        }
        if !ft.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(n) => n.to_lowercase(),
            None => continue,
        };
        if !is_model_weight_file(&name) {
            continue;
        }
        if name == target_base {
            exact = Some(path);
        } else if stem_hit.is_none() && stem_ci(&name) == target_stem {
            stem_hit = Some(path);
        }
    }

    if exact.is_some() {
        return exact;
    }

    for d in &subdirs {
        if let Some(found) = find_in_tree(d, target_base, target_stem, depth + 1) {
            let found_name = found
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_lowercase();
            if found_name == target_base {
                return Some(found);
            }
            if stem_hit.is_none() {
                stem_hit = Some(found);
            }
        }
    }

    stem_hit
}

/// Locate an already-downloaded model under the ComfyUI models root.
pub fn find_local_model(params: FindLocalModelParams) -> AppResult<FindLocalModelResult> {
    let root = PathBuf::from(params.root.trim());
    let empty = FindLocalModelResult {
        found: false,
        path: None,
        relative: None,
    };
    if !root.is_dir() {
        return Ok(empty);
    }

    let file_name = params.file_name.trim();
    if file_name.is_empty() {
        return Ok(empty);
    }

    let target_base = basename_ci(file_name);
    let target_stem = stem_ci(&target_base);
    if target_base.is_empty() {
        return Ok(empty);
    }

    let kind = params.kind.as_deref().unwrap_or("");
    let mut subdirs: Vec<&str> = search_subdirs_for_kind(kind).to_vec();

    // Main generative weights may already live in a sibling folder — always
    // also check the other common homes so we mark them installed correctly.
    if matches!(kind, "checkpoint" | "diffusion" | "") {
        for extra in ["checkpoints", "diffusion_models", "unet"] {
            if !subdirs.iter().any(|s| *s == extra) {
                subdirs.push(extra);
            }
        }
    }

    for sub in subdirs {
        let dir = root.join(sub);
        if let Some(found) = find_in_tree(&dir, &target_base, &target_stem, 0) {
            let relative = found
                .strip_prefix(&root)
                .ok()
                .map(|p| p.to_string_lossy().replace('\\', "/"));
            return Ok(FindLocalModelResult {
                found: true,
                path: Some(found.to_string_lossy().into()),
                relative,
            });
        }
    }

    Ok(empty)
}
