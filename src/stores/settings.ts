import { create } from "zustand";
import { Store } from "@tauri-apps/plugin-store";
import type { NsfwOption } from "@/api/types";
import { joinPath } from "@/lib/utils";

const STORE_FILE = "settings.json";

export interface SettingsState {
  hydrated: boolean;
  apiToken: string;
  /** Saved images & workflows folder */
  downloadDir: string;
  /** ComfyUI `models/` root — downloads go into checkpoints/loras/vae/… */
  comfyModelsDir: string;
  maxConcurrentDownloads: number;
  confirmBeforeDelete: boolean;
  defaultNsfw: NsfwOption;
  hydrate: () => Promise<void>;
  setApiToken: (apiToken: string) => Promise<void>;
  setDownloadDir: (downloadDir: string) => Promise<void>;
  setComfyModelsDir: (comfyModelsDir: string) => Promise<void>;
  setMaxConcurrentDownloads: (n: number) => Promise<void>;
  setConfirmBeforeDelete: (confirmBeforeDelete: boolean) => Promise<void>;
  setDefaultNsfw: (defaultNsfw: NsfwOption) => Promise<void>;
}

async function getStore() {
  return Store.load(STORE_FILE);
}

async function persist(key: string, value: unknown) {
  const store = await getStore();
  await store.set(key, value);
  await store.save();
}

function parentDir(path: string): string {
  const normalized = path.replace(/[/\\]+$/, "");
  const idx = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  return idx > 0 ? normalized.slice(0, idx) : normalized;
}

/** Migrate old per-type folders → single ComfyUI models root. */
async function migrateComfyRoot(store: Awaited<ReturnType<typeof getStore>>) {
  const existing = (await store.get<string>("comfyModelsDir")) ?? "";
  if (existing) return existing;

  const modelsDir = (await store.get<string>("modelsDir")) ?? "";
  const lorasDir = (await store.get<string>("lorasDir")) ?? "";
  const other = (await store.get<string>("otherModelsDir")) ?? "";

  for (const dir of [modelsDir, lorasDir, other]) {
    if (!dir) continue;
    if (/[/\\](checkpoints|loras|vae|embeddings)[/\\]?$/i.test(dir)) {
      return parentDir(dir);
    }
  }
  return other || modelsDir || lorasDir || "";
}

export const useSettingsStore = create<SettingsState>((set) => ({
  hydrated: false,
  apiToken: "",
  downloadDir: "",
  comfyModelsDir: "",
  maxConcurrentDownloads: 3,
  confirmBeforeDelete: true,
  defaultNsfw: "Soft",
  hydrate: async () => {
    try {
      const store = await getStore();
      const apiToken = (await store.get<string>("apiToken")) ?? "";
      const downloadDir = (await store.get<string>("downloadDir")) ?? "";
      const comfyModelsDir = await migrateComfyRoot(store);
      if (comfyModelsDir && !(await store.get<string>("comfyModelsDir"))) {
        await store.set("comfyModelsDir", comfyModelsDir);
        await store.save();
      }
      const maxConcurrentDownloads = Math.min(
        8,
        Math.max(1, (await store.get<number>("maxConcurrentDownloads")) ?? 3),
      );
      const confirmBeforeDelete =
        (await store.get<boolean>("confirmBeforeDelete")) ?? true;
      const defaultNsfw =
        (await store.get<NsfwOption>("defaultNsfw")) ?? "Soft";
      set({
        apiToken,
        downloadDir,
        comfyModelsDir,
        maxConcurrentDownloads,
        confirmBeforeDelete,
        defaultNsfw,
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },
  setApiToken: async (apiToken) => {
    set({ apiToken });
    await persist("apiToken", apiToken);
  },
  setDownloadDir: async (downloadDir) => {
    set({ downloadDir });
    await persist("downloadDir", downloadDir);
  },
  setComfyModelsDir: async (comfyModelsDir) => {
    set({ comfyModelsDir });
    await persist("comfyModelsDir", comfyModelsDir);
  },
  setMaxConcurrentDownloads: async (n) => {
    const maxConcurrentDownloads = Math.min(8, Math.max(1, Math.round(n)));
    set({ maxConcurrentDownloads });
    await persist("maxConcurrentDownloads", maxConcurrentDownloads);
  },
  setConfirmBeforeDelete: async (confirmBeforeDelete) => {
    set({ confirmBeforeDelete });
    await persist("confirmBeforeDelete", confirmBeforeDelete);
  },
  setDefaultNsfw: async (defaultNsfw) => {
    set({ defaultNsfw });
    await persist("defaultNsfw", defaultNsfw);
  },
}));

const KIND_SUBDIR: Record<string, string> = {
  checkpoint: "checkpoints",
  lora: "loras",
  embedding: "embeddings",
  vae: "vae",
};

/** Resolve download folder for a resource kind under the ComfyUI models root. */
export function dirForKind(
  kind: string,
  s: Pick<SettingsState, "comfyModelsDir" | "downloadDir">,
): string {
  const root = s.comfyModelsDir || s.downloadDir;
  if (!root) return "";
  const sub = KIND_SUBDIR[kind];
  return sub ? joinPath(root, sub) : root;
}
