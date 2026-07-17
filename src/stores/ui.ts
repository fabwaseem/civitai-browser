import { create } from "zustand";
import { Store } from "@tauri-apps/plugin-store";

export type ViewMode = "masonry" | "grid";
export type SettingsFocus = "models" | "images" | null;

const STORE_FILE = "settings.json";

interface UiState {
  hydrated: boolean;
  viewMode: ViewMode;
  filtersOpen: boolean;
  selectedId: number | null;
  preparingId: number | null;
  settingsOpen: boolean;
  settingsFocus: SettingsFocus;
  hydrate: () => Promise<void>;
  setViewMode: (viewMode: ViewMode) => void;
  setFiltersOpen: (filtersOpen: boolean) => void;
  toggleFiltersOpen: () => void;
  setSelectedId: (selectedId: number | null) => void;
  setPreparingId: (preparingId: number | null) => void;
  setSettingsOpen: (open: boolean) => void;
  openSettings: (focus?: SettingsFocus) => void;
}

async function persistViewMode(viewMode: ViewMode) {
  const store = await Store.load(STORE_FILE);
  await store.set("viewMode", viewMode);
  await store.save();
}

export const useUiStore = create<UiState>((set) => ({
  hydrated: false,
  viewMode: "masonry",
  filtersOpen: false,
  selectedId: null,
  preparingId: null,
  settingsOpen: false,
  settingsFocus: null,
  hydrate: async () => {
    try {
      const store = await Store.load(STORE_FILE);
      const viewMode = (await store.get<ViewMode>("viewMode")) ?? "masonry";
      set({ viewMode, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },
  setViewMode: (viewMode) => {
    set({ viewMode });
    void persistViewMode(viewMode);
  },
  setFiltersOpen: (filtersOpen) => set({ filtersOpen }),
  toggleFiltersOpen: () => set((s) => ({ filtersOpen: !s.filtersOpen })),
  setSelectedId: (selectedId) => set({ selectedId }),
  setPreparingId: (preparingId) => set({ preparingId }),
  setSettingsOpen: (settingsOpen) =>
    set((s) => ({
      settingsOpen,
      settingsFocus: settingsOpen ? s.settingsFocus : null,
    })),
  openSettings: (focus = null) =>
    set({ settingsOpen: true, settingsFocus: focus }),
}));
