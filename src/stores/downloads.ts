import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { UsedResource, UsedResourceKind } from "@/api/classifier";
import {
  cancelFileDownload,
  clearDownloadPartial,
  findLocalModel,
  resolveModelFile,
  startFileDownload,
  type DownloadProgressEvent,
  type ResolvedModelFile,
} from "@/api/tauri";
import { dirForKind, useSettingsStore } from "@/stores/settings";
import { fileBasename, joinPath, sameBasename } from "@/lib/utils";
import { notify } from "@/lib/toast";

export type DownloadStatus =
  | "queued"
  | "resolving"
  | "downloading"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

/** Strip raw JSON / HTTP noise into a short user-facing message. */
export function formatDownloadError(raw: string): string {
  const text = raw.trim();
  if (!text || text === "CANCELLED") return "";

  if (/download cancelled/i.test(text)) return "";

  if (/401|unauthorized/i.test(text)) {
    return "This file needs a token — add it in Settings.";
  }

  // Resolve misses: Civitai/HF search noise → one clear line
  if (
    /no civitai model found/i.test(text) ||
    /no hugging ?face/i.test(text) ||
    /none match/i.test(text) ||
    /no version of this model matches/i.test(text) ||
    /no downloadable files/i.test(text) ||
    /file has no downloadurl/i.test(text) ||
    /need modelversionid, hash, modelid, or a name/i.test(text) ||
    /multiple versions exist/i.test(text)
  ) {
    return "Model not found";
  }

  const jsonStart = text.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart)) as {
        message?: string;
        error?: string;
      };
      const msg = (parsed.message || parsed.error || "").trim();
      if (/401|unauthorized/i.test(text)) {
        return "This file needs a token — add it in Settings.";
      }
      if (msg && msg !== "Unauthorized" && msg !== "Error") {
        return formatDownloadError(msg);
      }
    } catch {
      /* fall through */
    }
  }

  // Keep short; drop trailing technical chains
  if (text.length > 80) {
    const first = text.split(/[.\n]/)[0]?.trim();
    if (first && first.length <= 80) return first;
    return "Download failed";
  }

  return text;
}

export interface DownloadJob {
  id: string;
  kind: UsedResourceKind;
  name: string;
  version?: string;
  modelId?: number;
  modelVersionId?: number;
  hash?: string;
  status: DownloadStatus;
  downloaded: number;
  total: number | null;
  speed: number;
  error?: string;
  destPath?: string;
  fileName?: string;
  downloadUrl?: string;
  createdAt: number;
}

export interface FlyBurst {
  id: string;
  x: number;
  y: number;
}

/** Same weights found under a different basename than the workflow expects. */
export interface AltInstallPrompt {
  resource: UsedResource;
  workflowName: string;
  localFileName: string;
  relative: string | null;
  path: string | null;
  from?: { x: number; y: number } | null;
}

export interface LocalResourceMatch {
  relative: string | null;
  path: string | null;
  /** Set when the on-disk basename differs from the workflow name */
  asName?: string;
}

interface DownloadsState {
  jobs: DownloadJob[];
  panelOpen: boolean;
  listening: boolean;
  flyBurst: FlyBurst | null;
  badgePulse: number;
  altInstallPrompt: AltInstallPrompt | null;
  setPanelOpen: (open: boolean) => void;
  clearFlyBurst: () => void;
  dismissAltInstall: () => void;
  ensureListener: () => Promise<void>;
  /** Look up workflow name, then hash-resolved source name if needed */
  probeLocalResource: (resource: UsedResource) => Promise<LocalResourceMatch | null>;
  enqueueResource: (
    resource: UsedResource,
    fromEl?: HTMLElement | { x: number; y: number } | null,
    opts?: { forceWorkflowName?: boolean },
  ) => Promise<void>;
  confirmDownloadAsWorkflow: () => Promise<void>;
  pauseJob: (id: string) => Promise<void>;
  resumeJob: (id: string) => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
  retryJob: (id: string) => Promise<void>;
  removeJob: (id: string) => Promise<void>;
  clearFinished: () => Promise<void>;
  pump: () => void;
}

let unlisten: UnlistenFn | null = null;
let pumping = false;

const resolveCache = new Map<string, ResolvedModelFile>();

function uid() {
  return `dl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function updateJob(
  set: (fn: (s: DownloadsState) => Partial<DownloadsState>) => void,
  id: string,
  patch: Partial<DownloadJob>,
) {
  set((s) => ({
    jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)),
  }));
}

function resolveCacheKey(resource: UsedResource): string | null {
  if (resource.hash?.trim()) return `h:${resource.hash.trim().toLowerCase()}`;
  if (resource.modelVersionId != null) return `v:${resource.modelVersionId}`;
  return null;
}

async function resolveForResource(
  resource: UsedResource,
): Promise<ResolvedModelFile | null> {
  const key = resolveCacheKey(resource);
  if (!key) return null;
  const hit = resolveCache.get(key);
  if (hit) return hit;

  const { apiToken: civitaiToken, hfToken } = useSettingsStore.getState();
  try {
    const resolved = await resolveModelFile({
      modelVersionId: resource.modelVersionId,
      modelId: resource.modelId,
      name: resource.name,
      preferredFileName: resource.name,
      hash: resource.hash,
      kind: resource.kind,
      apiToken: civitaiToken || undefined,
      hfToken: hfToken || undefined,
    });
    resolveCache.set(key, resolved);
    return resolved;
  } catch {
    return null;
  }
}

function originFrom(
  fromEl?: HTMLElement | { x: number; y: number } | null,
): { x: number; y: number } | null {
  if (fromEl instanceof HTMLElement) {
    const r = fromEl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
  }
  if (
    fromEl &&
    typeof fromEl === "object" &&
    "x" in fromEl &&
    "y" in fromEl &&
    typeof (fromEl as { x: unknown }).x === "number"
  ) {
    return fromEl as { x: number; y: number };
  }
  return null;
}

async function wipePartial(destPath?: string) {
  if (!destPath) return;
  try {
    await clearDownloadPartial(destPath);
  } catch {
    /* ignore missing / locked */
  }
}

async function pickDirIfNeeded(kind: string): Promise<string | null> {
  const settings = useSettingsStore.getState();
  const dir = dirForKind(kind, settings);
  if (dir) return dir;

  const { useUiStore } = await import("@/stores/ui");
  notify.modelsFolderRequired();
  useUiStore.getState().openSettings("models");
  return null;
}

async function runJob(jobId: string) {
  const get = () => useDownloadStore.getState();
  const set = useDownloadStore.setState;

  const job = get().jobs.find((j) => j.id === jobId);
  if (!job) return;

  const { apiToken: civitaiToken, hfToken } = useSettingsStore.getState();
  const apiToken = civitaiToken || undefined;
  const hfTokenOpt = hfToken || undefined;

  try {
    updateJob(set, jobId, {
      status: "resolving",
      error: undefined,
      speed: 0,
    });

    let resolved: ResolvedModelFile;
    if (job.downloadUrl && job.fileName && job.destPath) {
      resolved = {
        modelId: job.modelId ?? null,
        modelVersionId: job.modelVersionId ?? 0,
        modelName: job.name,
        versionName: job.version ?? "",
        fileName: job.fileName,
        sourceFileName: job.fileName,
        sizeKb: job.total != null ? job.total / 1024 : null,
        downloadUrl: job.downloadUrl,
        air: null,
      };
    } else {
      resolved = await resolveModelFile({
        modelVersionId: job.modelVersionId,
        modelId: job.modelId,
        name: job.name,
        preferredFileName: job.name,
        hash: job.hash,
        kind: job.kind,
        apiToken,
        hfToken: hfTokenOpt,
      });
    }

    const dir = await pickDirIfNeeded(job.kind);
    if (!dir) {
      updateJob(set, jobId, {
        status: "cancelled",
        error: "Set ComfyUI models folder in Settings",
      });
      get().pump();
      return;
    }

    const destNormalized = joinPath(dir, resolved.fileName);

    updateJob(set, jobId, {
      status: "downloading",
      fileName: resolved.fileName,
      downloadUrl: resolved.downloadUrl,
      destPath: destNormalized,
      modelId: resolved.modelId ?? job.modelId,
      modelVersionId: resolved.modelVersionId || job.modelVersionId,
      total:
        resolved.sizeKb != null ? Math.round(resolved.sizeKb * 1024) : job.total,
      // Keep workflow filename as the job label; store Civitai version name separately
      version: resolved.versionName || job.version,
    });

    await startFileDownload({
      jobId,
      url: resolved.downloadUrl,
      destPath: destNormalized,
      apiToken,
      hfToken: hfTokenOpt,
    });

    const current = get().jobs.find((j) => j.id === jobId);
    if (current && (current.status === "downloading" || current.status === "completed")) {
      if (current.status !== "completed") {
        updateJob(set, jobId, {
          status: "completed",
          destPath: destNormalized,
          speed: 0,
        });
      }
      notify.success(`Downloaded ${resolved.fileName}`);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const current = get().jobs.find((j) => j.id === jobId);
    if (current?.status === "paused") {
      updateJob(set, jobId, { status: "paused", speed: 0, error: undefined });
    } else if (
      current?.status === "cancelled" ||
      message === "CANCELLED" ||
      /cancelled/i.test(message)
    ) {
      updateJob(set, jobId, {
        status: "cancelled",
        error: undefined,
        speed: 0,
      });
    } else {
      const err = formatDownloadError(message) || message;
      updateJob(set, jobId, {
        status: "failed",
        error: err,
        speed: 0,
      });
      notify.error(err);
    }
  } finally {
    get().pump();
  }
}

export const useDownloadStore = create<DownloadsState>((set, get) => ({
  jobs: [],
  panelOpen: false,
  listening: false,
  flyBurst: null,
  badgePulse: 0,
  altInstallPrompt: null,

  setPanelOpen: (panelOpen) => set({ panelOpen }),
  clearFlyBurst: () => set({ flyBurst: null }),
  dismissAltInstall: () => set({ altInstallPrompt: null }),

  probeLocalResource: async (resource) => {
    const root = useSettingsStore.getState().comfyModelsDir;
    if (!root) return null;

    try {
      const exact = await findLocalModel({
        root,
        fileName: resource.name,
        kind: resource.kind,
      });
      if (exact.found) {
        return { relative: exact.relative, path: exact.path };
      }
    } catch {
      /* continue */
    }

    // Hash / version id → canonical source filename may already be on disk
    if (!resource.hash && resource.modelVersionId == null) return null;
    const resolved = await resolveForResource(resource);
    if (!resolved?.sourceFileName) return null;
    if (sameBasename(resolved.sourceFileName, resource.name)) return null;

    try {
      const alt = await findLocalModel({
        root,
        fileName: resolved.sourceFileName,
        kind: resource.kind,
      });
      if (!alt.found) return null;
      return {
        relative: alt.relative,
        path: alt.path,
        asName: fileBasename(resolved.sourceFileName),
      };
    } catch {
      return null;
    }
  },

  ensureListener: async () => {
    if (get().listening) return;
    unlisten?.();
    unlisten = await listen<DownloadProgressEvent>("download-progress", (event) => {
      const p = event.payload;
      const job = get().jobs.find((j) => j.id === p.jobId);
      if (!job) return;

      if (
        (job.status === "paused" || job.status === "cancelled") &&
        p.status === "downloading"
      ) {
        return;
      }

      const statusMap: Record<string, DownloadStatus> = {
        downloading: "downloading",
        completed: "completed",
        failed: "failed",
        cancelled: job.status === "paused" ? "paused" : "cancelled",
      };

      const nextStatus = statusMap[p.status] ?? job.status;
      const rawMessage = p.message ?? undefined;
      let error: string | undefined = job.error;

      if (nextStatus === "paused" || nextStatus === "cancelled") {
        error = undefined;
      } else if (nextStatus === "failed" && rawMessage) {
        error = formatDownloadError(rawMessage) || rawMessage;
      } else if (rawMessage && nextStatus === "downloading") {
        error = undefined;
      }

      updateJob(set, p.jobId, {
        downloaded: p.downloaded,
        total: p.total ?? job.total,
        speed: p.speed,
        status: nextStatus,
        error,
        destPath: p.destPath ?? job.destPath,
      });
    });
    set({ listening: true });
  },

  enqueueResource: async (resource, fromEl, opts) => {
    await get().ensureListener();

    const settings = useSettingsStore.getState();
    if (!settings.comfyModelsDir) {
      const { useUiStore } = await import("@/stores/ui");
      notify.modelsFolderRequired();
      useUiStore.getState().openSettings("models");
      return;
    }

    const origin = originFrom(fromEl);

    if (!opts?.forceWorkflowName) {
      const match = await get().probeLocalResource(resource);
      if (match && !match.asName) {
        notify.success(
          match.relative
            ? `Already installed · ${match.relative}`
            : `Already installed · ${resource.name}`,
        );
        return;
      }
      if (match?.asName) {
        set({
          altInstallPrompt: {
            resource,
            workflowName: fileBasename(resource.name),
            localFileName: match.asName,
            relative: match.relative,
            path: match.path,
            from: origin,
          },
        });
        return;
      }
    }

    const dup = get().jobs.find(
      (j) =>
        j.name === resource.name &&
        j.modelVersionId === resource.modelVersionId &&
        (j.status === "queued" ||
          j.status === "resolving" ||
          j.status === "downloading" ||
          j.status === "paused"),
    );

    const fly = origin
      ? { id: uid(), x: origin.x, y: origin.y }
      : null;

    if (dup) {
      set((s) => ({
        flyBurst: fly ?? s.flyBurst,
        badgePulse: s.badgePulse + 1,
        altInstallPrompt: null,
      }));
      return;
    }

    const job: DownloadJob = {
      id: uid(),
      kind: resource.kind,
      name: resource.name,
      version: resource.version,
      modelId: resource.modelId,
      modelVersionId: resource.modelVersionId,
      hash: resource.hash,
      status: "queued",
      downloaded: 0,
      total: null,
      speed: 0,
      createdAt: Date.now(),
    };
    set((s) => ({
      jobs: [job, ...s.jobs],
      badgePulse: s.badgePulse + 1,
      flyBurst: fly,
      altInstallPrompt: null,
    }));
    const short =
      resource.name.length > 36
        ? `${resource.name.slice(0, 34)}…`
        : resource.name;
    notify.success(`Queued ${short}`);
    get().pump();
  },

  confirmDownloadAsWorkflow: async () => {
    const prompt = get().altInstallPrompt;
    if (!prompt) return;
    set({ altInstallPrompt: null });
    await get().enqueueResource(prompt.resource, prompt.from, {
      forceWorkflowName: true,
    });
  },

  pauseJob: async (id) => {
    updateJob(set, id, { status: "paused", speed: 0 });
    await cancelFileDownload(id, false);
    get().pump();
  },

  resumeJob: async (id) => {
    const job = get().jobs.find((j) => j.id === id);
    if (!job) return;
    updateJob(set, id, {
      status: "queued",
      error: undefined,
    });
    get().pump();
  },

  cancelJob: async (id) => {
    const job = get().jobs.find((j) => j.id === id);
    updateJob(set, id, { status: "cancelled", speed: 0 });
    await cancelFileDownload(id, true);
    await wipePartial(job?.destPath);
    notify.info("Download cancelled");
    get().pump();
  },

  retryJob: async (id) => {
    updateJob(set, id, {
      status: "queued",
      error: undefined,
      downloaded: 0,
      speed: 0,
    });
    get().pump();
  },

  removeJob: async (id) => {
    const job = get().jobs.find((j) => j.id === id);
    if (
      job &&
      (job.status === "downloading" ||
        job.status === "resolving" ||
        job.status === "queued")
    ) {
      await cancelFileDownload(id, true);
    }
    if (job && job.status !== "completed") {
      await wipePartial(job.destPath);
    }
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));
    get().pump();
  },

  clearFinished: async () => {
    const finished = get().jobs.filter(
      (j) =>
        j.status === "completed" ||
        j.status === "failed" ||
        j.status === "cancelled",
    );
    for (const job of finished) {
      if (job.status !== "completed") {
        await wipePartial(job.destPath);
      }
    }
    set((s) => ({
      jobs: s.jobs.filter(
        (j) =>
          j.status !== "completed" &&
          j.status !== "failed" &&
          j.status !== "cancelled",
      ),
    }));
  },

  pump: () => {
    if (pumping) return;
    pumping = true;
    try {
      const max = useSettingsStore.getState().maxConcurrentDownloads;
      const active = get().jobs.filter(
        (j) => j.status === "downloading" || j.status === "resolving",
      ).length;
      const slots = Math.max(0, max - active);
      if (slots === 0) return;
      const queued = get()
        .jobs.filter((j) => j.status === "queued")
        .slice()
        .reverse();
      for (const job of queued.slice(0, slots)) {
        void runJob(job.id);
      }
    } finally {
      pumping = false;
    }
  },
}));
