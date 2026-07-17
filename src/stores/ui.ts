import { create } from "zustand";

export type ViewMode = "masonry" | "grid";

interface UiState {
  viewMode: ViewMode;
  filtersOpen: boolean;
  selectedId: number | null;
  preparingId: number | null;
  setViewMode: (viewMode: ViewMode) => void;
  setFiltersOpen: (filtersOpen: boolean) => void;
  toggleFiltersOpen: () => void;
  setSelectedId: (selectedId: number | null) => void;
  setPreparingId: (preparingId: number | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  viewMode: "masonry",
  filtersOpen: false,
  selectedId: null,
  preparingId: null,
  setViewMode: (viewMode) => set({ viewMode }),
  setFiltersOpen: (filtersOpen) => set({ filtersOpen }),
  toggleFiltersOpen: () => set((s) => ({ filtersOpen: !s.filtersOpen })),
  setSelectedId: (selectedId) => set({ selectedId }),
  setPreparingId: (preparingId) => set({ preparingId }),
}));
