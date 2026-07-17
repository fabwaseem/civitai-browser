import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateOffer = {
  version: string;
  notes: string;
  update: Update;
};

export type UpdateProgress = {
  phase: "downloading" | "installing" | "done";
  downloaded: number;
  total: number | null;
  /** 0–100 with one decimal when known */
  percent: number | null;
  /** Bytes/sec averaged over the last ~1s window */
  speed: number | null;
};

const PROGRESS_TICK_MS = 1000;

/** Quiet network / missing-release errors on launch. */
function isBenignCheckError(message: string) {
  return /error sending request|failed to fetch|404|Could not fetch|not found|EOF|timed out/i.test(
    message,
  );
}

export async function probeForUpdate(): Promise<UpdateOffer | null> {
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body?.trim() || "A new version is available.",
    update,
  };
}

function exactPercent(downloaded: number, total: number | null): number | null {
  if (total == null || total <= 0) return null;
  const capped = Math.min(downloaded, total);
  return Math.min(100, Math.round((capped / total) * 1000) / 10);
}

export async function installUpdateAndRelaunch(
  update: Update,
  onProgress?: (progress: UpdateProgress) => void,
) {
  let downloaded = 0;
  let total: number | null = null;
  let speed: number | null = null;

  let windowStart = performance.now();
  let windowBytes = 0;
  let lastEmit = 0;

  const snapshot = (
    phase: UpdateProgress["phase"],
  ): UpdateProgress => ({
    phase,
    downloaded: total != null ? Math.min(downloaded, total) : downloaded,
    total,
    percent: exactPercent(downloaded, total),
    speed: phase === "downloading" ? speed : null,
  });

  const emit = (phase: UpdateProgress["phase"], force = false) => {
    const now = performance.now();
    if (
      !force &&
      phase === "downloading" &&
      now - lastEmit < PROGRESS_TICK_MS
    ) {
      return;
    }
    lastEmit = now;
    onProgress?.(snapshot(phase));
  };

  const rollSpeed = (chunk: number) => {
    const now = performance.now();
    windowBytes += chunk;
    const elapsed = now - windowStart;
    if (elapsed >= PROGRESS_TICK_MS) {
      speed = (windowBytes * 1000) / elapsed;
      windowStart = now;
      windowBytes = 0;
    }
  };

  await update.downloadAndInstall((event: DownloadEvent) => {
    if (event.event === "Started") {
      downloaded = 0;
      total = event.data.contentLength ?? null;
      speed = null;
      windowStart = performance.now();
      windowBytes = 0;
      lastEmit = 0;
      emit("downloading", true);
    } else if (event.event === "Progress") {
      const chunk = event.data.chunkLength;
      downloaded += chunk;
      if (total != null && downloaded > total) downloaded = total;
      rollSpeed(chunk);
      emit("downloading");
    } else if (event.event === "Finished") {
      if (total != null) downloaded = total;
      speed = null;
      emit("installing", true);
    }
  });

  emit("done", true);
  await relaunch();
}

/** Settings / manual path — confirm dialog then install. */
export async function checkForAppUpdate(interactive: boolean): Promise<string> {
  try {
    const offer = await probeForUpdate();
    if (!offer) {
      return interactive ? "You're on the latest version." : "";
    }

    const shouldInstall = window.confirm(
      `Update ${offer.version} is available.\n\n${offer.notes}\n\nDownload and install now?`,
    );

    if (!shouldInstall) {
      return `Update ${offer.version} available (skipped).`;
    }

    await installUpdateAndRelaunch(offer.update);
    return "Update installed. Restarting…";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!interactive && isBenignCheckError(message)) return "";
    return interactive ? `Update check failed: ${message}` : "";
  }
}
