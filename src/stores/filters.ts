import { create } from "zustand";
import { Store } from "@tauri-apps/plugin-store";
import type {
  NsfwOption,
  PeriodOption,
  SortOption,
  WorkflowMode,
} from "@/api/types";

const STORE_FILE = "settings.json";
const FILTERS_KEY = "filters";

export interface FilterState {
  hydrated: boolean;
  sort: SortOption;
  period: PeriodOption;
  nsfw: NsfwOption;
  username: string;
  modelId: string;
  modelVersionId: string;
  baseModels: string;
  workflowMode: WorkflowMode;
  hydrate: () => Promise<void>;
  setSort: (sort: SortOption) => void;
  setPeriod: (period: PeriodOption) => void;
  setNsfw: (nsfw: NsfwOption) => void;
  setUsername: (username: string) => void;
  setModelId: (modelId: string) => void;
  setModelVersionId: (modelVersionId: string) => void;
  setBaseModels: (baseModels: string) => void;
  setWorkflowMode: (workflowMode: WorkflowMode) => void;
  reset: () => void;
}

export const filterDefaults = {
  sort: "Newest" as SortOption,
  period: "AllTime" as PeriodOption,
  nsfw: "Soft" as NsfwOption,
  username: "",
  modelId: "",
  modelVersionId: "",
  baseModels: "",
  workflowMode: "workflow" as WorkflowMode,
};

const defaults = filterDefaults;

type PersistedFilters = typeof defaults;

export function isFiltersDirty(
  state: Pick<
    FilterState,
    | "sort"
    | "period"
    | "nsfw"
    | "username"
    | "modelId"
    | "modelVersionId"
    | "baseModels"
    | "workflowMode"
  >,
  defaultNsfw: NsfwOption = defaults.nsfw,
) {
  return (
    state.sort !== defaults.sort ||
    state.period !== defaults.period ||
    state.nsfw !== defaultNsfw ||
    state.username !== defaults.username ||
    state.modelId !== defaults.modelId ||
    state.modelVersionId !== defaults.modelVersionId ||
    state.baseModels !== defaults.baseModels ||
    state.workflowMode !== defaults.workflowMode
  );
}

async function getStore() {
  return Store.load(STORE_FILE);
}

async function persistFilters(state: FilterState) {
  const payload: PersistedFilters = {
    sort: state.sort,
    period: state.period,
    nsfw: state.nsfw,
    username: state.username,
    modelId: state.modelId,
    modelVersionId: state.modelVersionId,
    baseModels: state.baseModels,
    workflowMode: state.workflowMode,
  };
  const store = await getStore();
  await store.set(FILTERS_KEY, payload);
  await store.save();
}

function patchAndSave(
  set: (partial: Partial<FilterState>) => void,
  get: () => FilterState,
  partial: Partial<FilterState>,
) {
  set(partial);
  void persistFilters(get());
}

export const useFilterStore = create<FilterState>((set, get) => ({
  hydrated: false,
  ...defaults,
  hydrate: async () => {
    try {
      const store = await getStore();
      const saved = (await store.get<Partial<PersistedFilters>>(FILTERS_KEY)) ?? {};
      const defaultNsfw =
        (await store.get<NsfwOption>("defaultNsfw")) ?? defaults.nsfw;
      set({
        sort: saved.sort ?? defaults.sort,
        period: saved.period ?? defaults.period,
        nsfw: saved.nsfw ?? defaultNsfw,
        username: saved.username ?? defaults.username,
        modelId: saved.modelId ?? defaults.modelId,
        modelVersionId: saved.modelVersionId ?? defaults.modelVersionId,
        baseModels: saved.baseModels ?? defaults.baseModels,
        workflowMode: saved.workflowMode ?? defaults.workflowMode,
        hydrated: true,
      });
    } catch {
      set({ hydrated: true });
    }
  },
  setSort: (sort) => patchAndSave(set, get, { sort }),
  setPeriod: (period) => patchAndSave(set, get, { period }),
  setNsfw: (nsfw) => patchAndSave(set, get, { nsfw }),
  setUsername: (username) => patchAndSave(set, get, { username }),
  setModelId: (modelId) => patchAndSave(set, get, { modelId }),
  setModelVersionId: (modelVersionId) =>
    patchAndSave(set, get, { modelVersionId }),
  setBaseModels: (baseModels) => patchAndSave(set, get, { baseModels }),
  setWorkflowMode: (workflowMode) => patchAndSave(set, get, { workflowMode }),
  reset: () => {
    void (async () => {
      try {
        const store = await getStore();
        const defaultNsfw =
          (await store.get<NsfwOption>("defaultNsfw")) ?? defaults.nsfw;
        const next = { ...defaults, nsfw: defaultNsfw };
        set(next);
        await persistFilters({ ...get(), ...next });
      } catch {
        set({ ...defaults });
        void persistFilters(get());
      }
    })();
  },
}));
