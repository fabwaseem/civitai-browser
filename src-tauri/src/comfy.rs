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
    "clip_vision",
    "unet",
    "diffusion_models",
    "upscale_models",
    "hypernetworks",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComfyModelsDirInfo {
    pub path: String,
    pub valid: bool,
    pub reason: String,
    pub found: Vec<String>,
    pub missing_common: Vec<String>,
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
    let valid = named_models || found.len() >= 2 || found.iter().any(|f| f == "checkpoints");

    let reason = if valid {
        if found.is_empty() {
            "Accepted as ComfyUI models folder (will create subfolders as needed)".into()
        } else {
            format!("Looks like a ComfyUI models folder (found: {})", found.join(", "))
        }
    } else {
        "Doesn't look like a ComfyUI models folder — pick the folder that contains checkpoints/, loras/, vae/".into()
    };

    Ok(ComfyModelsDirInfo {
        path: root.to_string_lossy().into(),
        valid,
        reason,
        found,
        missing_common,
    })
}
