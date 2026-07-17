import type { CivitaiImage, MetaKind } from "./types";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMaybeJson(value: unknown): unknown {
  if (isPlainObject(value) || Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/** ComfyUI API prompt graph: numeric node ids with class_type */
export function isComfyApiPrompt(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  let numeric = 0;
  let withClass = 0;
  for (const key of keys) {
    if (!/^\d+$/.test(key)) continue;
    numeric += 1;
    const node = value[key];
    if (isPlainObject(node) && typeof node.class_type === "string") {
      withClass += 1;
    }
  }
  return numeric >= 1 && withClass >= 1;
}

/** ComfyUI UI workflow: nodes + links */
export function isComfyUiWorkflow(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  return Array.isArray(value.nodes);
}

export interface ComfyBundle {
  /** UI workflow JSON (preferred for drag into ComfyUI canvas) */
  workflow?: Record<string, unknown>;
  /** API prompt graph */
  prompt?: Record<string, unknown>;
}

/**
 * Resolve a real ComfyUI graph from Civitai image meta.
 *
 * Important: `meta.workflow` is often just `"txt2img"` / `"img2img"` from
 * Civitai's on-site generator — that is NOT a Comfy graph.
 * Real graphs usually live in `meta.comfy` as a JSON string:
 * `{ "prompt": {...}, "workflow": { "nodes": [...], "links": [...] } }`.
 */
export function extractComfyBundle(
  meta?: Record<string, unknown> | null,
): ComfyBundle | null {
  if (!meta || !isPlainObject(meta)) return null;

  // 1) Preferred: packed ComfyUI blob
  const comfy = parseMaybeJson(meta.comfy);
  if (isPlainObject(comfy)) {
    const promptCandidate = comfy.prompt ?? null;
    const workflowCandidate = comfy.workflow ?? null;
    const prompt = isComfyApiPrompt(promptCandidate)
      ? promptCandidate
      : isComfyApiPrompt(comfy)
        ? comfy
        : undefined;
    const workflow = isComfyUiWorkflow(workflowCandidate)
      ? workflowCandidate
      : isComfyUiWorkflow(comfy)
        ? comfy
        : undefined;
    if (prompt || workflow) return { prompt, workflow };
  }

  // 2) Top-level workflow only if it is real JSON graph (not "txt2img")
  const topWorkflow = parseMaybeJson(meta.workflow);
  if (isComfyUiWorkflow(topWorkflow)) {
    return { workflow: topWorkflow };
  }
  if (isComfyApiPrompt(topWorkflow)) {
    return { prompt: topWorkflow };
  }

  // 3) Top-level prompt graph
  if (isComfyApiPrompt(meta.prompt)) {
    return { prompt: meta.prompt };
  }
  const parsedPrompt = parseMaybeJson(meta.prompt);
  if (isComfyApiPrompt(parsedPrompt)) {
    return { prompt: parsedPrompt };
  }

  // 4) Occasional alternate keys
  for (const key of ["workflow_json", "ComfyUI Workflow", "comfyui"]) {
    const parsed = parseMaybeJson(meta[key]);
    if (isComfyUiWorkflow(parsed)) return { workflow: parsed };
    if (isComfyApiPrompt(parsed)) return { prompt: parsed };
    if (isPlainObject(parsed)) {
      const nested = extractComfyBundle(parsed);
      if (nested) return nested;
    }
  }

  return null;
}

export function getMetaKind(image: CivitaiImage): MetaKind {
  const meta = image.meta;
  if (!meta || !isPlainObject(meta) || Object.keys(meta).length === 0) {
    return "none";
  }

  if (extractComfyBundle(meta)) {
    return "workflow";
  }

  return "meta";
}

export function hasWorkflow(image: CivitaiImage) {
  return getMetaKind(image) === "workflow";
}

export function extractPrompt(meta?: Record<string, unknown> | null) {
  if (!meta) return "";
  const prompt = meta.prompt;
  if (typeof prompt === "string") return prompt;
  return "";
}

export function extractNegativePrompt(meta?: Record<string, unknown> | null) {
  if (!meta) return "";
  const value = meta.negativePrompt ?? meta.negative_prompt;
  return typeof value === "string" ? value : "";
}

/** Pretty UI workflow JSON for copy/save (falls back to API prompt graph). */
export function extractWorkflowJson(meta?: Record<string, unknown> | null) {
  const bundle = extractComfyBundle(meta);
  if (!bundle) return null;
  const graph = bundle.workflow ?? bundle.prompt;
  if (!graph) return null;
  return JSON.stringify(graph, null, 2);
}

/** Compact strings for PNG tEXt embedding (ComfyUI reads these keys). */
export function comfyPngTextChunks(meta?: Record<string, unknown> | null): {
  workflowJson?: string;
  promptJson?: string;
} {
  const bundle = extractComfyBundle(meta);
  if (!bundle) return {};
  return {
    workflowJson: bundle.workflow
      ? JSON.stringify(bundle.workflow)
      : undefined,
    promptJson: bundle.prompt ? JSON.stringify(bundle.prompt) : undefined,
  };
}

/**
 * Civitai CDN path segment before the filename controls size/format, e.g.
 * `original=true` or `width=320,optimized=true`.
 * API currently returns `original=true` by default — never use that for gallery.
 */
function withCdnTransform(imageUrl: string, transform: string) {
  const u = new URL(imageUrl);
  u.searchParams.delete("width");
  u.searchParams.delete("optimized");

  const parts = u.pathname.split("/").filter(Boolean);
  const transformIdx = parts.findIndex(
    (p) =>
      /(^|,)(width|original|optimized|anim)=/i.test(p) ||
      /^width=\d+/i.test(p) ||
      /^original=/i.test(p) ||
      /^optimized=/i.test(p),
  );

  if (transformIdx >= 0) {
    parts[transformIdx] = transform;
  } else if (parts.length >= 2) {
    const file = parts.pop()!;
    parts.push(transform, file);
  }

  u.pathname = `/${parts.join("/")}`;
  return u.toString();
}

export function originalImageUrl(image: CivitaiImage) {
  try {
    return withCdnTransform(image.url, "original=true");
  } catch {
    return image.url;
  }
}

/** Small CDN derivative for fast drag ghost / prefetch icon. */
export function previewImageUrl(image: CivitaiImage, width = 120) {
  try {
    return withCdnTransform(image.url, `width=${width},optimized=true`);
  } catch {
    return image.url;
  }
}

/** Gallery/grid display URL — never originals; optimized thumbs only. */
export function galleryImageUrl(image: CivitaiImage, width = 320) {
  const w = Math.min(Math.max(Math.round(width), 200), 450);
  try {
    return withCdnTransform(image.url, `width=${w},optimized=true`);
  } catch {
    return image.url;
  }
}
