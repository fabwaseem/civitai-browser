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

export function clearImageCache() {
  return invoke<number>("clear_image_cache_cmd");
}
