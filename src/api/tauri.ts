import { invoke } from "@tauri-apps/api/core";
import type {
  CachedImage,
  FetchImagesParams,
  ImagesResponse,
} from "./types";

export function fetchCivitaiImages(params: FetchImagesParams) {
  return invoke<ImagesResponse>("fetch_civitai_images", { params });
}

export interface CacheImageArgs {
  imageId: number;
  url: string;
  apiToken?: string;
  preferredExt?: string;
  workflowJson?: string;
  promptJson?: string;
}

export function ensureCachedImage(params: CacheImageArgs) {
  return invoke<CachedImage>("ensure_cached_image_cmd", { params });
}

export function ensurePreviewImage(params: {
  imageId: number;
  url: string;
  apiToken?: string;
}) {
  return invoke<CachedImage>("ensure_preview_image_cmd", { params });
}

export function saveImage(
  params: CacheImageArgs & { destinationDir: string },
) {
  return invoke<string>("save_image_cmd", { params });
}

export function openPath(path: string) {
  return invoke<void>("open_path_cmd", { path });
}

export function writeTextFile(path: string, contents: string) {
  return invoke<void>("write_text_file_cmd", { path, contents });
}

export function clearImageCache() {
  return invoke<number>("clear_image_cache_cmd");
}

export interface DragReadyPaths {
  imageId: number;
  original: string;
  preview: string;
}

/** Instant disk check — no downloads. */
export function lookupDragReady(imageIds: number[]) {
  return invoke<DragReadyPaths[]>("lookup_drag_ready_cmd", { imageIds });
}

/** Download/cache original + drag icon in one round-trip. */
export function ensureDragReady(params: CacheImageArgs) {
  return invoke<DragReadyPaths>("ensure_drag_ready_cmd", { params });
}

export interface ResolveModelArgs {
  modelVersionId?: number;
  modelId?: number;
  name?: string;
  /** Comfy/workflow filename — used to pick exact version and save path */
  preferredFileName?: string;
  /** Civitai file hash (AutoV2 / SHA256 / …) for exact lookup */
  hash?: string;
  kind?: string;
  apiToken?: string;
  /** Hugging Face token for mirrors / gated HF repos */
  hfToken?: string;
}

export interface ResolvedModelFile {
  modelId: number | null;
  modelVersionId: number;
  modelName: string;
  versionName: string;
  fileName: string;
  sizeKb: number | null;
  downloadUrl: string;
  air: string | null;
}

export function resolveModelFile(params: ResolveModelArgs) {
  return invoke<ResolvedModelFile>("resolve_model_file_cmd", { params });
}

export interface StartFileDownloadArgs {
  jobId: string;
  url: string;
  destPath: string;
  apiToken?: string;
  /** Used when the download URL is on huggingface.co */
  hfToken?: string;
}

export function startFileDownload(params: StartFileDownloadArgs) {
  return invoke<string>("start_file_download_cmd", { params });
}

export function cancelFileDownload(jobId: string, discardPartial = true) {
  return invoke<boolean>("cancel_file_download_cmd", {
    jobId,
    discardPartial,
  });
}

export function clearDownloadPartial(destPath: string) {
  return invoke<boolean>("clear_download_partial_cmd", { destPath });
}

export interface ComfyModelsDirInfo {
  path: string;
  valid: boolean;
  reason: string;
  found: string[];
  missingCommon: string[];
}

export function inspectComfyModelsDir(path: string) {
  return invoke<ComfyModelsDirInfo>("inspect_comfy_models_dir_cmd", { path });
}

export interface FindLocalModelArgs {
  root: string;
  fileName: string;
  kind?: string;
}

export interface FindLocalModelResult {
  found: boolean;
  path: string | null;
  relative: string | null;
}

export function findLocalModel(params: FindLocalModelArgs) {
  return invoke<FindLocalModelResult>("find_local_model_cmd", { params });
}

export interface DownloadProgressEvent {
  jobId: string;
  downloaded: number;
  total: number | null;
  speed: number;
  status: string;
  message: string | null;
  destPath: string | null;
}

