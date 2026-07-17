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
  percent: number | null;
};

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

export async function installUpdateAndRelaunch(
  update: Update,
  onProgress?: (progress: UpdateProgress) => void,
) {
  let downloaded = 0;
  let total: number | null = null;

  const emit = (phase: UpdateProgress["phase"]) => {
    onProgress?.({
      phase,
      downloaded,
      total,
      percent:
        total && total > 0
          ? Math.min(100, Math.round((downloaded / total) * 100))
          : null,
    });
  };

  await update.downloadAndInstall((event: DownloadEvent) => {
    if (event.event === "Started") {
      downloaded = 0;
      total = event.data.contentLength ?? null;
      emit("downloading");
    } else if (event.event === "Progress") {
      downloaded += event.data.chunkLength;
      emit("downloading");
    } else if (event.event === "Finished") {
      emit("installing");
    }
  });

  emit("done");
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
