import {
  comfyPngTextChunks,
  extractComfyBundle,
  originalImageUrl,
} from "./classifier";
import type { CivitaiImage } from "./types";
import type { CacheImageArgs } from "./tauri";

/** Build cache/download args that preserve or restore ComfyUI-loadable PNG metadata. */
export function comfyExportArgs(
  image: CivitaiImage,
  apiToken?: string,
): CacheImageArgs {
  const chunks = comfyPngTextChunks(image.meta);
  const bundle = extractComfyBundle(image.meta);

  // Prefer embedding both keys when available. If only one exists, still embed it.
  let workflowJson = chunks.workflowJson;
  let promptJson = chunks.promptJson;

  // ComfyUI drag-load is happiest with a UI `workflow` chunk; if we only have
  // an API prompt graph, put it in `prompt` (and also as workflow fallback).
  if (!workflowJson && promptJson) {
    workflowJson = undefined;
  }
  if (!promptJson && workflowJson && bundle?.workflow) {
    // leave prompt empty — UI workflow alone is enough for canvas restore
  }

  return {
    imageId: image.id,
    url: originalImageUrl(image),
    apiToken: apiToken || undefined,
    workflowJson,
    promptJson,
  };
}
