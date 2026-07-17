import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/** Returns a user-facing status string. Prompts before install when an update exists. */
export async function checkForAppUpdate(interactive: boolean): Promise<string> {
  try {
    const update = await check();
    if (!update) {
      return interactive ? "You're on the latest version." : "";
    }

    const notes = update.body?.trim() || "A new version is available.";
    const shouldInstall = window.confirm(
      `Update ${update.version} is available.\n\n${notes}\n\nDownload and install now?`,
    );

    if (!shouldInstall) {
      return `Update ${update.version} available (skipped).`;
    }

    await update.downloadAndInstall();
    await relaunch();
    return "Update installed. Restarting…";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Quiet on launch when releases endpoint is not ready yet
    if (
      !interactive &&
      /error sending request|failed to fetch|404|Could not fetch/i.test(message)
    ) {
      return "";
    }
    return interactive ? `Update check failed: ${message}` : "";
  }
}
