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

export type UsedResourceKind = "checkpoint" | "lora" | "embedding" | "vae" | "other";

export interface UsedResource {
  kind: UsedResourceKind;
  name: string;
  version?: string;
  weight?: number;
  modelId?: number;
  modelVersionId?: number;
}

/**
 * Well-known VAE filenames / stems (matched case-insensitively, with or without extension).
 * Used when Comfy/Civitai type metadata is missing or wrong.
 */
export const KNOWN_VAES = [
  "ae",
  "ae.safetensors",
  "flux-vae",
  "flux_vae",
  "sdxl_vae",
  "sdxl_vae.safetensors",
  "sdxl-vae",
  "vae-ft-mse-840000-ema-pruned",
  "vae-ft-mse-840000",
  "sd-vae-ft-mse",
  "sd-vae-ft-ema",
  "kl-f8-anime2",
  "orangemix",
  "orangemix.vae",
  "animevae",
  "clearvae",
  "blessed2",
  "blessed2_fp16",
  "color101vae",
  "qwen_image_vae",
  "qwenimagevae",
  "qwen_image_vae.safetensors",
  "qwenimagevae_qwenimagevae",
  "wan_2.1_vae",
  "wan21_vae",
  "hunyuan_vae",
  "hunyuanvideo_vae",
] as const;

function normalizeResourceKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.(safetensors|ckpt|pt|bin|pth)$/i, "")
    .replace(/[\s\-_.]+/g, "")
    .trim();
}

const KNOWN_VAE_KEYS = new Set(
  KNOWN_VAES.map((n) => normalizeResourceKey(n)).filter(Boolean),
);

/** True if filename looks like / is a known VAE. */
export function isVaeName(name: string): boolean {
  const lower = name.toLowerCase();
  const key = normalizeResourceKey(name);
  if (KNOWN_VAE_KEYS.has(key)) return true;
  // path segments: models/vae/foo.safetensors
  if (/[/\\]vae[/\\]/i.test(lower)) return true;
  // common naming: *_vae*, *vae_*, *-vae*, qwen_image_vae, …
  if (/(^|[_\-.\s])vae([_\-.\s]|$)/i.test(lower)) return true;
  if (/vae[_-]?(ft|mse|ema|sdxl|sd|flux|anime|qwen|wan)/i.test(lower)) {
    return true;
  }
  if (/(sdxl|flux|qwen|wan|hunyuan).{0,24}vae/i.test(lower)) return true;
  return false;
}

function classifyResourceType(raw?: string | null): UsedResourceKind {
  const t = (raw ?? "").toLowerCase();
  if (!t) return "other";
  if (t.includes("checkpoint") || t === "model" || t.includes("unet")) {
    return "checkpoint";
  }
  if (t.includes("lora") || t.includes("lycoris") || t.includes("locon")) {
    return "lora";
  }
  if (t.includes("embed") || t.includes("textual")) return "embedding";
  if (t.includes("vae")) return "vae";
  return "other";
}

/** Prefer explicit type, then filename heuristics (especially VAE). */
function resolveResourceKind(
  typeHint: string | null | undefined,
  name: string,
): UsedResourceKind {
  const fromType = classifyResourceType(typeHint);
  if (fromType === "vae" || isVaeName(name)) return "vae";
  if (fromType !== "other") return fromType;
  const lower = name.toLowerCase();
  if (/\.(pt|bin)$/i.test(lower) && /embed|textual|ti[_-]/i.test(lower)) {
    return "embedding";
  }
  if (/lora|lycoris|locon/i.test(lower)) return "lora";
  return "other";
}

function pushUnique(list: UsedResource[], item: UsedResource) {
  const key = `${item.kind}|${item.name}|${item.version ?? ""}|${item.modelVersionId ?? ""}`;
  if (list.some((x) => `${x.kind}|${x.name}|${x.version ?? ""}|${x.modelVersionId ?? ""}` === key)) {
    return;
  }
  list.push(item);
}

/** Some Comfy custom nodes store LoRAs as a JSON array/object string. */
function expandNamedResources(
  raw: string,
  kind: UsedResourceKind,
): UsedResource[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (
    (trimmed.startsWith("[") || trimmed.startsWith("{")) &&
    (trimmed.includes('"name"') ||
      trimmed.includes('"lora"') ||
      trimmed.includes('"display_name"'))
  ) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const out: UsedResource[] = [];
      for (const entry of items) {
        if (typeof entry === "string" && entry.trim()) {
          out.push({ kind, name: entry.trim() });
          continue;
        }
        if (!isPlainObject(entry)) continue;
        const name =
          (typeof entry.display_name === "string" && entry.display_name) ||
          (typeof entry.lora === "string" && entry.lora) ||
          (typeof entry.name === "string" && entry.name) ||
          (typeof entry.modelName === "string" && entry.modelName) ||
          "";
        if (!name) continue;
        const weight =
          typeof entry.weight === "number"
            ? entry.weight
            : typeof entry.strength === "number"
              ? entry.strength
              : typeof entry.text_encoder_weight === "number"
                ? entry.text_encoder_weight
                : undefined;
        out.push({ kind, name, weight });
      }
      if (out.length) {
        return out.map((item) => ({
          ...item,
          kind: resolveResourceKind(kind, item.name),
        }));
      }
    } catch {
      /* fall through */
    }
  }

  return [{ kind: resolveResourceKind(kind, trimmed), name: trimmed }];
}

function resourcesFromCivitaiMeta(meta: Record<string, unknown>): UsedResource[] {
  const out: UsedResource[] = [];
  const raw = meta.civitaiResources ?? meta.resources;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!isPlainObject(entry)) continue;
      const name =
        (typeof entry.modelName === "string" && entry.modelName) ||
        (typeof entry.name === "string" && entry.name) ||
        (typeof entry.model === "string" && entry.model) ||
        "";
      if (!name) continue;
      const version =
        typeof entry.modelVersionName === "string"
          ? entry.modelVersionName
          : typeof entry.versionName === "string"
            ? entry.versionName
            : undefined;
      const weight =
        typeof entry.weight === "number"
          ? entry.weight
          : typeof entry.strength === "number"
            ? entry.strength
            : undefined;
      const modelId =
        typeof entry.modelId === "number" ? entry.modelId : undefined;
      const modelVersionId =
        typeof entry.modelVersionId === "number"
          ? entry.modelVersionId
          : undefined;
      pushUnique(out, {
        kind: resolveResourceKind(
          typeof entry.type === "string" ? entry.type : null,
          name,
        ),
        name,
        version,
        weight,
        modelId,
        modelVersionId,
      });
    }
  }

  const modelName =
    (typeof meta.Model === "string" && meta.Model) ||
    (typeof meta.model === "string" && meta.model) ||
    "";
  if (modelName && !out.some((r) => r.kind === "checkpoint")) {
    pushUnique(out, { kind: "checkpoint", name: modelName });
  }

  return out;
}

function resourcesFromComfyPrompt(prompt: Record<string, unknown>): UsedResource[] {
  const out: UsedResource[] = [];
  for (const node of Object.values(prompt)) {
    if (!isPlainObject(node)) continue;
    const classType =
      typeof node.class_type === "string" ? node.class_type : "";
    const inputs = isPlainObject(node.inputs) ? node.inputs : {};

    if (/checkpoint|unetloader/i.test(classType)) {
      const name =
        (typeof inputs.ckpt_name === "string" && inputs.ckpt_name) ||
        (typeof inputs.unet_name === "string" && inputs.unet_name) ||
        (typeof inputs.model_name === "string" && inputs.model_name) ||
        "";
      if (name) {
        pushUnique(out, {
          kind: resolveResourceKind("checkpoint", name),
          name,
        });
      }
    }

    if (/lora/i.test(classType)) {
      const rawName =
        (typeof inputs.lora_name === "string" && inputs.lora_name) ||
        (typeof inputs.lora === "string" && inputs.lora) ||
        "";
      if (!rawName) continue;
      const weight =
        typeof inputs.strength_model === "number"
          ? inputs.strength_model
          : typeof inputs.strength === "number"
            ? inputs.strength
            : undefined;
      for (const item of expandNamedResources(rawName, "lora")) {
        pushUnique(out, {
          ...item,
          weight: item.weight ?? weight,
        });
      }
    }

    if (/vae/i.test(classType) && typeof inputs.vae_name === "string") {
      pushUnique(out, {
        kind: resolveResourceKind("vae", inputs.vae_name),
        name: inputs.vae_name,
      });
    }

    if (/embedding|textual/i.test(classType)) {
      const name =
        (typeof inputs.embedding_name === "string" && inputs.embedding_name) ||
        (typeof inputs.name === "string" && inputs.name) ||
        "";
      if (name) pushUnique(out, { kind: "embedding", name });
    }
  }
  return out;
}

function resourcesFromComfyWorkflow(workflow: Record<string, unknown>): UsedResource[] {
  const out: UsedResource[] = [];
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  for (const node of nodes) {
    if (!isPlainObject(node)) continue;
    const type =
      (typeof node.type === "string" && node.type) ||
      (typeof node.class_type === "string" && node.class_type) ||
      "";
    const widgets = Array.isArray(node.widgets_values)
      ? node.widgets_values
      : [];
    const firstStr = widgets.find((w) => typeof w === "string") as
      | string
      | undefined;

    if (/checkpoint|unetloader/i.test(type) && firstStr) {
      for (const item of expandNamedResources(firstStr, "checkpoint")) {
        pushUnique(out, item);
      }
    } else if (/lora/i.test(type) && firstStr) {
      const strength = widgets.find((w) => typeof w === "number") as
        | number
        | undefined;
      for (const item of expandNamedResources(firstStr, "lora")) {
        pushUnique(out, { ...item, weight: item.weight ?? strength });
      }
    } else if (/vae/i.test(type) && firstStr) {
      for (const item of expandNamedResources(firstStr, "vae")) {
        pushUnique(out, item);
      }
    }
  }
  return out;
}

/** Checkpoint / LoRA / related assets referenced by image meta or Comfy graph. */
export function extractUsedResources(
  meta?: Record<string, unknown> | null,
): UsedResource[] {
  if (!meta || !isPlainObject(meta)) return [];

  const out: UsedResource[] = [];
  for (const item of resourcesFromCivitaiMeta(meta)) pushUnique(out, item);

  // Some UIs dump LoRA stacks as a top-level JSON string
  for (const key of ["Loras", "loras", "lora", "LoRA"]) {
    const val = meta[key];
    if (typeof val === "string" && val.trim().startsWith("[")) {
      for (const item of expandNamedResources(val, "lora")) {
        pushUnique(out, item);
      }
    }
  }

  const bundle = extractComfyBundle(meta);
  if (bundle?.prompt) {
    for (const item of resourcesFromComfyPrompt(bundle.prompt)) {
      pushUnique(out, item);
    }
  }
  if (bundle?.workflow) {
    for (const item of resourcesFromComfyWorkflow(bundle.workflow)) {
      pushUnique(out, item);
    }
  }

  // Prefer named kinds first in UI
  const order: UsedResourceKind[] = [
    "checkpoint",
    "lora",
    "vae",
    "embedding",
    "other",
  ];
  return out
    .map((r) => ({
      ...r,
      kind: resolveResourceKind(r.kind, r.name),
    }))
    .sort(
      (a, b) =>
        order.indexOf(a.kind) - order.indexOf(b.kind) ||
        a.name.localeCompare(b.name),
    );
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
