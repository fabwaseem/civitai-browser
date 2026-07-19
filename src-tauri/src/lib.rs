mod cache;
mod civitai;
mod comfy;
mod download;
mod error;

use cache::{
    clear_image_cache, ensure_cached_image, ensure_drag_ready, ensure_preview_image,
    lookup_drag_ready, open_path, save_image_to_dir, CacheImageParams, DragReadyPaths,
    PreviewImageParams, SaveImageParams,
};
use civitai::{fetch_images, FetchImagesParams, ImagesResponse};
use comfy::{
    find_local_model, inspect_comfy_models_dir, ComfyModelsDirInfo, FindLocalModelParams,
    FindLocalModelResult,
};
use download::{
    resolve_model_file, start_file_download, DownloadManager, ResolveModelParams,
    ResolvedModelFile, StartFileDownloadParams,
};
use error::AppResult;
use tauri::{AppHandle, State};

#[tauri::command]
async fn fetch_civitai_images(params: FetchImagesParams) -> AppResult<ImagesResponse> {
    fetch_images(params).await
}

#[tauri::command]
async fn ensure_cached_image_cmd(
    app: AppHandle,
    params: CacheImageParams,
) -> AppResult<cache::CachedImage> {
    ensure_cached_image(&app, params).await
}

#[tauri::command]
async fn ensure_preview_image_cmd(
    app: AppHandle,
    params: PreviewImageParams,
) -> AppResult<cache::CachedImage> {
    ensure_preview_image(&app, params).await
}

#[tauri::command]
async fn save_image_cmd(app: AppHandle, params: SaveImageParams) -> AppResult<String> {
    save_image_to_dir(&app, params).await
}

#[tauri::command]
fn open_path_cmd(path: String) -> AppResult<()> {
    open_path(path)
}

#[tauri::command]
fn write_text_file_cmd(path: String, contents: String) -> AppResult<()> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    std::fs::write(path, contents)?;
    Ok(())
}

#[tauri::command]
fn clear_image_cache_cmd(app: AppHandle) -> AppResult<u64> {
    clear_image_cache(&app)
}

#[tauri::command]
fn lookup_drag_ready_cmd(app: AppHandle, image_ids: Vec<i64>) -> AppResult<Vec<DragReadyPaths>> {
    lookup_drag_ready(&app, &image_ids)
}

#[tauri::command]
async fn ensure_drag_ready_cmd(
    app: AppHandle,
    params: CacheImageParams,
) -> AppResult<DragReadyPaths> {
    ensure_drag_ready(&app, params).await
}

#[tauri::command]
async fn resolve_model_file_cmd(params: ResolveModelParams) -> AppResult<ResolvedModelFile> {
    resolve_model_file(params).await
}

#[tauri::command]
async fn start_file_download_cmd(
    app: AppHandle,
    manager: State<'_, DownloadManager>,
    params: StartFileDownloadParams,
) -> AppResult<String> {
    start_file_download(app, manager.inner(), params).await
}

#[tauri::command]
fn cancel_file_download_cmd(
    manager: State<'_, DownloadManager>,
    job_id: String,
    discard_partial: Option<bool>,
) -> AppResult<bool> {
    Ok(manager.cancel(&job_id, discard_partial.unwrap_or(true)))
}

#[tauri::command]
fn clear_download_partial_cmd(dest_path: String) -> AppResult<bool> {
    download::clear_download_partial(&dest_path)
}

#[tauri::command]
fn inspect_comfy_models_dir_cmd(path: String) -> AppResult<ComfyModelsDirInfo> {
    inspect_comfy_models_dir(path)
}

#[tauri::command]
fn find_local_model_cmd(params: FindLocalModelParams) -> AppResult<FindLocalModelResult> {
    find_local_model(params)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(DownloadManager::new())
        .invoke_handler(tauri::generate_handler![
            fetch_civitai_images,
            ensure_cached_image_cmd,
            ensure_preview_image_cmd,
            ensure_drag_ready_cmd,
            lookup_drag_ready_cmd,
            save_image_cmd,
            open_path_cmd,
            write_text_file_cmd,
            clear_image_cache_cmd,
            resolve_model_file_cmd,
            start_file_download_cmd,
            cancel_file_download_cmd,
            clear_download_partial_cmd,
            inspect_comfy_models_dir_cmd,
            find_local_model_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
