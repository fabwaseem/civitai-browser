import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { UsedResource, UsedResourceKind } from "@/api/classifier";
import {
  cancelFileDownload,
  clearDownloadPartial,
  resolveModelFile,
  startFileDownload,
  type DownloadProgressEvent,
  type ResolvedModelFile,
} from "@/api/tauri";
import { dirForKind, useSettingsStore } from "@/stores/settings";
import { joinPath } from "@/lib/utils";
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

  const jsonStart = text.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart)) as {
        message?: string;
        error?: string;
      };
      const msg = (parsed.message || parsed.error || "").trim();
      if (/401|unauthorized/i.test(text)) {
        return msg && msg !== "Unauthorized"
          ? `${msg} Add your Civitai API token in Settings.`
          : "This file requires authentication. Add your Civitai API token in Settings.";
      }
      if (msg && msg !== "Unauthorized" && msg !== "Error") return msg;
    } catch {
      /* fall through */
    }
  }

  if (/401|unauthorized/i.test(text)) {
    return "This file requires authentication. Add your Civitai API token in Settings.";
  }
  if (/download cancelled/i.test(text)) return "";
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

interface DownloadsState {
  jobs: DownloadJob[];
  panelOpen: boolean;
  listening: boolean;
  flyBurst: FlyBurst | null;
  badgePulse: number;
  setPanelOpen: (open: boolean) => void;
  clearFlyBurst: () => void;
  ensureListener: () => Promise<void>;
  enqueueResource: (
    resource: UsedResource,
    fromEl?: HTMLElement | { x: number; y: number } | null,
  ) => Promise<void>;
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

  setPanelOpen: (panelOpen) => set({ panelOpen }),
  clearFlyBurst: () => set({ flyBurst: null }),

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

  enqueueResource: async (resource, fromEl) => {
    await get().ensureListener();

    const settings = useSettingsStore.getState();
    if (!settings.comfyModelsDir) {
      const { useUiStore } = await import("@/stores/ui");
      notify.modelsFolderRequired();
      useUiStore.getState().openSettings("models");
      return;
    }

    try {
      const { findLocalModel } = await import("@/api/tauri");
      const local = await findLocalModel({
        root: settings.comfyModelsDir,
        fileName: resource.name,
        kind: resource.kind,
      });
      if (local.found) {
        notify.success(
          local.relative
            ? `Already installed · ${local.relative}`
            : `Already installed · ${resource.name}`,
        );
        return;
      }
    } catch {
      /* proceed with download if lookup fails */
    }

    const origin = (() => {
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
    })();

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
    }));
    const short =
      resource.name.length > 36
        ? `${resource.name.slice(0, 34)}…`
        : resource.name;
    notify.success(`Queued ${short}`);
    get().pump();
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
