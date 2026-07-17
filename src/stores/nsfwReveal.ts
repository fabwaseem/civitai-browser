import { create } from "zustand";

/** Session-only NSFW reveals (cleared on app restart). */
interface NsfwRevealState {
  revealed: Record<number, true>;
  reveal: (id: number) => void;
  hide: (id: number) => void;
  isRevealed: (id: number) => boolean;
}

export const useNsfwRevealStore = create<NsfwRevealState>((set, get) => ({
  revealed: {},
  reveal: (id) =>
    set((s) => ({ revealed: { ...s.revealed, [id]: true } })),
  hide: (id) =>
    set((s) => {
      const next = { ...s.revealed };
      delete next[id];
      return { revealed: next };
    }),
  isRevealed: (id) => !!get().revealed[id],
}));
