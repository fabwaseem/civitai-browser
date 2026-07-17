import { create } from "zustand";
import { Store } from "@tauri-apps/plugin-store";
import type { NsfwOption } from "@/api/types";

const STORE_FILE = "settings.json";

export interface SettingsState {
  hydrated: boolean;
  apiToken: string;
  downloadDir: string;
  defaultNsfw: NsfwOption;
  hydrate: () => Promise<void>;
  setApiToken: (apiToken: string) => Promise<void>;
  setDownloadDir: (downloadDir: string) => Promise<void>;
  setDefaultNsfw: (defaultNsfw: NsfwOption) => Promise<void>;
}

async function getStore() {
  return Store.load(STORE_FILE);
}

export const useSettingsStore = create<SettingsState>((set) => ({
  hydrated: false,
  apiToken: "",
  downloadDir: "",
  defaultNsfw: "Soft",
  hydrate: async () => {
    try {
      const store = await getStore();
      const apiToken = (await store.get<string>("apiToken")) ?? "";
      const downloadDir = (await store.get<string>("downloadDir")) ?? "";
      const defaultNsfw =
        (await store.get<NsfwOption>("defaultNsfw")) ?? "Soft";
      set({ apiToken, downloadDir, defaultNsfw, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
  setApiToken: async (apiToken) => {
    set({ apiToken });
    const store = await getStore();
    await store.set("apiToken", apiToken);
    await store.save();
  },
  setDownloadDir: async (downloadDir) => {
    set({ downloadDir });
    const store = await getStore();
    await store.set("downloadDir", downloadDir);
    await store.save();
  },
  setDefaultNsfw: async (defaultNsfw) => {
    set({ defaultNsfw });
    const store = await getStore();
    await store.set("defaultNsfw", defaultNsfw);
    await store.save();
    // keep filter store in sync if still at previous default
    const { useFilterStore } = await import("./filters");
    useFilterStore.getState().setNsfw(defaultNsfw);
  },
}));
