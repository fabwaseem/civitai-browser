import { create } from "zustand";
import type {
  NsfwOption,
  PeriodOption,
  SortOption,
  WorkflowMode,
} from "@/api/types";

export interface FilterState {
  sort: SortOption;
  period: PeriodOption;
  nsfw: NsfwOption;
  username: string;
  modelId: string;
  modelVersionId: string;
  baseModels: string;
  workflowMode: WorkflowMode;
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

const defaults = {
  sort: "Newest" as SortOption,
  period: "AllTime" as PeriodOption,
  nsfw: "Soft" as NsfwOption,
  username: "",
  modelId: "",
  modelVersionId: "",
  baseModels: "",
  workflowMode: "workflow" as WorkflowMode,
};

export const useFilterStore = create<FilterState>((set) => ({
  ...defaults,
  setSort: (sort) => set({ sort }),
  setPeriod: (period) => set({ period }),
  setNsfw: (nsfw) => set({ nsfw }),
  setUsername: (username) => set({ username }),
  setModelId: (modelId) => set({ modelId }),
  setModelVersionId: (modelVersionId) => set({ modelVersionId }),
  setBaseModels: (baseModels) => set({ baseModels }),
  setWorkflowMode: (workflowMode) => set({ workflowMode }),
  reset: () => set(defaults),
}));
