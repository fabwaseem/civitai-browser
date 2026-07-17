mod cache;
mod civitai;
mod error;

use cache::{
    clear_image_cache, ensure_cached_image, ensure_drag_ready, ensure_preview_image,
    lookup_drag_ready, open_path, save_image_to_dir, CacheImageParams, DragReadyPaths,
    PreviewImageParams, SaveImageParams,
};
use civitai::{fetch_images, FetchImagesParams, ImagesResponse};
use error::AppResult;
use tauri::AppHandle;

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
        .invoke_handler(tauri::generate_handler![
            fetch_civitai_images,
            ensure_cached_image_cmd,
            ensure_preview_image_cmd,
            ensure_drag_ready_cmd,
            lookup_drag_ready_cmd,
            save_image_cmd,
            open_path_cmd,
            clear_image_cache_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
