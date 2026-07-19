import { create } from "zustand";
import { Store } from "@tauri-apps/plugin-store";
import type { NsfwOption } from "@/api/types";
import type { BlurNsfwFrom } from "@/lib/nsfw";
import { joinPath } from "@/lib/utils";

const STORE_FILE = "settings.json";

export interface SettingsState {
  hydrated: boolean;
  apiToken: string;
  /** Hugging Face token for gated / rate-limited model mirrors */
  hfToken: string;
  /** Saved images & workflows folder */
  downloadDir: string;
  /** ComfyUI `models/` root — downloads go into checkpoints/loras/vae/… */
  comfyModelsDir: string;
  maxConcurrentDownloads: number;
  confirmBeforeDelete: boolean;
  defaultNsfw: NsfwOption;
  /** Soften / hide NSFW thumbs in the gallery */
  blurNsfw: boolean;
  /** Blur images at this level and above */
  blurNsfwFrom: BlurNsfwFrom;
  hydrate: () => Promise<void>;
  setApiToken: (apiToken: string) => Promise<void>;
  setHfToken: (hfToken: string) => Promise<void>;
  setDownloadDir: (downloadDir: string) => Promise<void>;
  setComfyModelsDir: (comfyModelsDir: string) => Promise<void>;
  setMaxConcurrentDownloads: (n: number) => Promise<void>;
  setConfirmBeforeDelete: (confirmBeforeDelete: boolean) => Promise<void>;
  setDefaultNsfw: (defaultNsfw: NsfwOption) => Promise<void>;
  setBlurNsfw: (blurNsfw: boolean) => Promise<void>;
  setBlurNsfwFrom: (blurNsfwFrom: BlurNsfwFrom) => Promise<void>;
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
    if (/[/\\](checkpoints|diffusion_models|unet|loras|vae|embeddings|text_encoders|clip|upscale_models)[/\\]?$/i.test(dir)) {
      return parentDir(dir);
    }
  }
  return other || modelsDir || lorasDir || "";
}

export const useSettingsStore = create<SettingsState>((set) => ({
  hydrated: false,
  apiToken: "",
  hfToken: "",
  downloadDir: "",
  comfyModelsDir: "",
  maxConcurrentDownloads: 3,
  confirmBeforeDelete: true,
  defaultNsfw: "Soft",
  blurNsfw: true,
  blurNsfwFrom: "Mature",
  hydrate: async () => {
    try {
      const store = await getStore();
      const apiToken = (await store.get<string>("apiToken")) ?? "";
      const hfToken = (await store.get<string>("hfToken")) ?? "";
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
      const blurNsfw = (await store.get<boolean>("blurNsfw")) ?? true;
      const savedFrom = await store.get<string>("blurNsfwFrom");
      const blurNsfwFrom: BlurNsfwFrom =
        savedFrom === "Soft" || savedFrom === "Mature" || savedFrom === "X"
          ? savedFrom
          : "Mature";
      set({
        apiToken,
        hfToken,
        downloadDir,
        comfyModelsDir,
        maxConcurrentDownloads,
        confirmBeforeDelete,
        defaultNsfw,
        blurNsfw,
        blurNsfwFrom,
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
  setHfToken: async (hfToken) => {
    set({ hfToken });
    await persist("hfToken", hfToken);
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
  setBlurNsfw: async (blurNsfw) => {
    set({ blurNsfw });
    await persist("blurNsfw", blurNsfw);
  },
  setBlurNsfwFrom: async (blurNsfwFrom) => {
    set({ blurNsfwFrom });
    await persist("blurNsfwFrom", blurNsfwFrom);
  },
}));

const KIND_SUBDIR: Record<string, string> = {
  checkpoint: "checkpoints",
  diffusion: "diffusion_models",
  clip: "text_encoders",
  lora: "loras",
  embedding: "embeddings",
  vae: "vae",
  upscale: "upscale_models",
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
