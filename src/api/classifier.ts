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

export type UsedResourceKind =
  | "checkpoint"
  | "diffusion"
  | "clip"
  | "lora"
  | "embedding"
  | "vae"
  | "upscale"
  | "other";

export interface UsedResource {
  kind: UsedResourceKind;
  name: string;
  version?: string;
  weight?: number;
  modelId?: number;
  modelVersionId?: number;
  /** Civitai file hash (AutoV2 / SHA256 / etc.) when present in meta */
  hash?: string;
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

/** Common ComfyUI upscaler filenames (ESRGAN / RealESRGAN / etc.). */
export const KNOWN_UPSCALERS = [
  "4x-ultrasharp",
  "4x_ultrasharp",
  "4x-ultrasharp.pth",
  "4x-animesharp",
  "4x_animesharp",
  "4x-ultramix_balanced",
  "4x_foolhardy_remacri",
  "4xfoolhardyremacri",
  "realesrgan_x4plus",
  "realesrgan_x4plus.pth",
  "realesrgan_x4plus_anime_6b",
  "realesrgan_x2plus",
  "realesrnet_x4plus",
  "esrgan_4x",
  "4xnomos8kdat",
  "4x_nomos8k_dat",
  "4xlsdir",
  "8x_nmkd-superscale_150000_g",
  "8x_nmkd_superscale",
  "2x_animesharpv2_fast",
] as const;

function normalizeResourceKey(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  return base
    .toLowerCase()
    .replace(/\.(safetensors|ckpt|pt|bin|pth)$/i, "")
    .replace(/[\s\-_.]+/g, "")
    .trim();
}

const KNOWN_VAE_KEYS = new Set(
  KNOWN_VAES.map((n) => normalizeResourceKey(n)).filter(Boolean),
);

const KNOWN_UPSCALER_KEYS = new Set(
  KNOWN_UPSCALERS.map((n) => normalizeResourceKey(n)).filter(Boolean),
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

/** True if filename looks like an ESRGAN / RealESRGAN / Comfy upscaler. */
export function isUpscaleName(name: string): boolean {
  const lower = name.toLowerCase();
  const key = normalizeResourceKey(name);
  if (KNOWN_UPSCALER_KEYS.has(key)) return true;
  if (/[/\\]upscale[_-]?models?[/\\]/i.test(lower)) return true;
  if (
    /\b(ultrasharp|animesharp|remacri|realesrgan|realesrnet|esrgan|nomos|nmkd|superscale|lsdir|swinir|hat[_-]?gan)\b/i.test(
      lower,
    )
  ) {
    return true;
  }
  // Typical OpenModelDB / ESRGAN naming: 4x-Foo, 2x_Bar, 8xNMKD…
  if (/^(?:\d+x[-_]|x\d+[-_])/i.test(basenameOf(name))) return true;
  return false;
}

function classifyResourceType(raw?: string | null): UsedResourceKind {
  const t = (raw ?? "").toLowerCase();
  if (!t) return "other";
  if (
    t.includes("unet") ||
    t.includes("diffusion") ||
    t === "diffusion_model"
  ) {
    return "diffusion";
  }
  if (
    t.includes("clip") ||
    t.includes("textencoder") ||
    t.includes("text_encoder") ||
    t.includes("text-encoder") ||
    t.includes("t5")
  ) {
    return "clip";
  }
  if (t.includes("checkpoint") || t === "model") {
    return "checkpoint";
  }
  if (t.includes("lora") || t.includes("lycoris") || t.includes("locon")) {
    return "lora";
  }
  if (t.includes("embed") || t.includes("textual")) return "embedding";
  if (t.includes("vae")) return "vae";
  if (
    t.includes("upscale") ||
    t.includes("esrgan") ||
    t.includes("realesrgan")
  ) {
    return "upscale";
  }
  return "other";
}

/** Prefer explicit type, then filename heuristics (especially VAE / upscale). */
function resolveResourceKind(
  typeHint: string | null | undefined,
  name: string,
): UsedResourceKind {
  const fromType = classifyResourceType(typeHint);
  if (fromType === "vae" || isVaeName(name)) return "vae";
  if (fromType === "upscale" || isUpscaleName(name)) return "upscale";
  if (fromType !== "other") return fromType;
  const lower = name.toLowerCase();
  if (/\.(pt|bin)$/i.test(lower) && /embed|textual|ti[_-]/i.test(lower)) {
    return "embedding";
  }
  if (/lora|lycoris|locon/i.test(lower)) return "lora";
  return "other";
}

/** Comfy loader node → folder kind (authoritative for download destination). */
function kindFromComfyNode(classType: string): UsedResourceKind | null {
  const t = classType.toLowerCase();
  if (/unetloader|diffusionmodelloader|loaddiffusionmodel|unetloadergguf/i.test(t)) {
    return "diffusion";
  }
  if (
    /dualcliploader|triplecliploader|cliploader|cliptextencode|textencoderloader|t5/i.test(
      t,
    ) &&
    /loader/i.test(t)
  ) {
    return "clip";
  }
  if (/checkpointloader/i.test(t)) return "checkpoint";
  if (/lora/i.test(t) && /loader|loaderamodel/i.test(t)) return "lora";
  if (/vaeloader/i.test(t)) return "vae";
  if (
    /upscalemodelloader|loadupscalemodel|imageupscalewithmodel|ultimatesdupscale|cr_?upscale/i.test(
      t,
    )
  ) {
    return "upscale";
  }
  return null;
}

/** When merging meta + Comfy, prefer folder-specific kinds from the graph. */
function preferKind(a: UsedResourceKind, b: UsedResourceKind): UsedResourceKind {
  if (a === b) return a;
  if (a === "other") return b;
  if (b === "other") return a;
  if (a === "diffusion" || b === "diffusion") return "diffusion";
  if (a === "clip" || b === "clip") return "clip";
  if (a === "vae" || b === "vae") return "vae";
  if (a === "upscale" || b === "upscale") return "upscale";
  if (a === "lora" || b === "lora") return "lora";
  if (a === "embedding" || b === "embedding") return "embedding";
  return a;
}

function hasModelExtension(name: string): boolean {
  return /\.(safetensors|ckpt|pt|bin|pth|gguf)$/i.test(name);
}

function basenameOf(name: string): string {
  return name.split(/[/\\]/).pop()?.trim() || name.trim();
}

/** Prefer the Comfy-style filename (with extension) over a bare display name. */
function preferResourceName(current: string, incoming: string): string {
  const a = basenameOf(current);
  const b = basenameOf(incoming);
  if (hasModelExtension(b) && !hasModelExtension(a)) return b;
  if (hasModelExtension(a) && !hasModelExtension(b)) return a;
  // Prefer the longer basename when both look similar (path vs bare)
  if (b.length > a.length) return b;
  return a;
}

/** Checkpoint + diffusion are the same asset family (Civitai vs UNETLoader). */
function dedupeFamily(kind: UsedResourceKind): string {
  if (kind === "checkpoint" || kind === "diffusion") return "main";
  return kind;
}

function mergeResource(into: UsedResource, from: UsedResource): UsedResource {
  return {
    kind: preferKind(into.kind, from.kind),
    name: preferResourceName(into.name, from.name),
    version: into.version ?? from.version,
    weight: into.weight ?? from.weight,
    modelId: into.modelId ?? from.modelId,
    modelVersionId: into.modelVersionId ?? from.modelVersionId,
    hash: into.hash ?? from.hash,
  };
}

function pushUnique(list: UsedResource[], item: UsedResource) {
  const key = `${dedupeFamily(item.kind)}|${normalizeResourceKey(item.name)}`;
  const idx = list.findIndex(
    (x) => `${dedupeFamily(x.kind)}|${normalizeResourceKey(x.name)}` === key,
  );
  if (idx >= 0) {
    list[idx] = mergeResource(list[idx], item);
    return;
  }
  list.push({ ...item, name: basenameOf(item.name) });
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
        (typeof entry.fileName === "string" && entry.fileName) ||
        "";
      const modelVersionId =
        typeof entry.modelVersionId === "number"
          ? entry.modelVersionId
          : undefined;
      // Some entries are ID-only (`{ type, modelVersionId }`) — still useful
      if (!name && modelVersionId == null) continue;
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
      const hash =
        (typeof entry.hash === "string" && entry.hash) ||
        (typeof entry.SHA256 === "string" && entry.SHA256) ||
        (typeof entry.AutoV2 === "string" && entry.AutoV2) ||
        undefined;
      const displayName =
        name ||
        (version ? `version-${modelVersionId} (${version})` : `version-${modelVersionId}`);
      pushUnique(out, {
        kind: resolveResourceKind(
          typeof entry.type === "string" ? entry.type : null,
          displayName,
        ),
        name: displayName,
        version,
        weight,
        modelId,
        modelVersionId,
        hash,
      });
    }
  }

  // A1111-style hashes: { "model": "ABC…", "lora:name": "DEF…" }
  const hashes = meta.hashes;
  if (isPlainObject(hashes)) {
    for (const [key, value] of Object.entries(hashes)) {
      if (typeof value !== "string" || !value.trim()) continue;
      const hash = value.trim();
      if (/^model$/i.test(key) || /^checkpoint:/i.test(key)) {
        const existing = out.find((r) => r.kind === "checkpoint" && !r.hash);
        if (existing) existing.hash = hash;
        else if (!out.some((r) => r.kind === "checkpoint")) {
          pushUnique(out, {
            kind: "checkpoint",
            name: typeof meta.Model === "string" ? meta.Model : "checkpoint",
            hash,
          });
        }
        continue;
      }
      const loraMatch = key.match(/^lora:(.+)$/i);
      if (loraMatch) {
        const loraName = loraMatch[1];
        const existing = out.find(
          (r) =>
            r.kind === "lora" &&
            normalizeResourceKey(r.name) === normalizeResourceKey(loraName),
        );
        if (existing) existing.hash = existing.hash ?? hash;
        else pushUnique(out, { kind: "lora", name: loraName, hash });
      }
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

    if (/checkpoint|unetloader|diffusionmodel/i.test(classType)) {
      const name =
        (typeof inputs.ckpt_name === "string" && inputs.ckpt_name) ||
        (typeof inputs.unet_name === "string" && inputs.unet_name) ||
        (typeof inputs.model_name === "string" && inputs.model_name) ||
        "";
      if (name) {
        const fromNode = kindFromComfyNode(classType);
        pushUnique(out, {
          kind: fromNode ?? resolveResourceKind("checkpoint", name),
          name,
        });
      }
    }

    if (/cliploader|textencoderloader|dualcliploader|triplecliploader/i.test(classType)) {
      const name =
        (typeof inputs.clip_name === "string" && inputs.clip_name) ||
        (typeof inputs.clip_name1 === "string" && inputs.clip_name1) ||
        (typeof inputs.text_encoder === "string" && inputs.text_encoder) ||
        (typeof inputs.ckpt_name === "string" && inputs.ckpt_name) ||
        "";
      if (name) {
        pushUnique(out, {
          kind: kindFromComfyNode(classType) ?? "clip",
          name,
        });
      }
      const name2 =
        (typeof inputs.clip_name2 === "string" && inputs.clip_name2) ||
        (typeof inputs.clip_name3 === "string" && inputs.clip_name3) ||
        "";
      if (name2) {
        pushUnique(out, { kind: "clip", name: name2 });
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

    if (
      /upscale|esrgan/i.test(classType) &&
      !/latentupscale|imagescale|upscalelatent/i.test(classType)
    ) {
      const name =
        (typeof inputs.model_name === "string" && inputs.model_name) ||
        (typeof inputs.upscale_model === "string" && inputs.upscale_model) ||
        (typeof inputs.model === "string" && inputs.model) ||
        (typeof inputs.ckpt_name === "string" && inputs.ckpt_name) ||
        "";
      if (name && (hasModelExtension(name) || isUpscaleName(name))) {
        pushUnique(out, {
          kind: kindFromComfyNode(classType) ?? "upscale",
          name,
        });
      }
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

    if (/checkpoint|unetloader|diffusionmodel/i.test(type) && firstStr) {
      const fromNode = kindFromComfyNode(type) ?? "checkpoint";
      for (const item of expandNamedResources(firstStr, fromNode)) {
        pushUnique(out, { ...item, kind: fromNode });
      }
    } else if (
      /cliploader|textencoderloader|dualcliploader|triplecliploader/i.test(type)
    ) {
      for (const w of widgets) {
        if (typeof w === "string" && w.trim() && hasModelExtension(w)) {
          pushUnique(out, { kind: "clip", name: w.trim() });
        }
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
    } else if (
      /upscale|esrgan/i.test(type) &&
      !/latentupscale|imagescale|upscalelatent/i.test(type)
    ) {
      for (const w of widgets) {
        if (typeof w !== "string" || !w.trim()) continue;
        if (hasModelExtension(w) || isUpscaleName(w)) {
          pushUnique(out, {
            kind: kindFromComfyNode(type) ?? "upscale",
            name: w.trim(),
          });
        }
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
    "diffusion",
    "clip",
    "lora",
    "vae",
    "upscale",
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

/**
 * High-res CDN derivative for lightbox / fullscreen viewing.
 * Falls back to the original when the requested width is near native size.
 */
export function lightboxImageUrl(image: CivitaiImage, width = 1920) {
  const native = image.width > 0 ? image.width : width;
  const w = Math.min(Math.max(Math.round(width), 200), 3840);
  if (w >= native * 0.9) return originalImageUrl(image);
  try {
    return withCdnTransform(image.url, `width=${w},optimized=true`);
  } catch {
    return image.url;
  }
}
