import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateOffer = {
  version: string;
  notes: string;
  update: Update;
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

export async function installUpdateAndRelaunch(update: Update) {
  await update.downloadAndInstall();
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
