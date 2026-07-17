import {
  useInfiniteQuery,
  type InfiniteData,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { getMetaKind } from "./classifier";
import { fetchCivitaiImages } from "./tauri";
import type {
  CivitaiImage,
  FetchImagesParams,
  ImagesResponse,
  WorkflowMode,
} from "./types";
import { useFilterStore } from "@/stores/filters";
import { useSettingsStore } from "@/stores/settings";

const PAGE_SIZE = 100;
const TARGET_VISIBLE = 36;
const MAX_FILL_PAGES = 4;

function parseOptionalInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function buildFetchParams(
  filters: ReturnType<typeof useFilterStore.getState>,
  apiToken: string,
  cursor?: string,
): FetchImagesParams {
  return {
    limit: PAGE_SIZE,
    cursor: cursor || undefined,
    sort: filters.sort,
    period: filters.period,
    nsfw: filters.nsfw,
    username: filters.username.trim() || undefined,
    modelId: parseOptionalInt(filters.modelId),
    modelVersionId: parseOptionalInt(filters.modelVersionId),
    baseModels: filters.baseModels.trim() || undefined,
    apiToken: apiToken || undefined,
  };
}

function matchesMode(image: CivitaiImage, mode: WorkflowMode) {
  const kind = getMetaKind(image);
  if (mode === "all") return true;
  if (mode === "meta") return kind === "meta" || kind === "workflow";
  return kind === "workflow";
}

async function fetchWithSmartFill(
  baseParams: FetchImagesParams,
  mode: WorkflowMode,
  pageParam?: string,
): Promise<ImagesResponse & { kept: CivitaiImage[] }> {
  let cursor = pageParam;
  let pages = 0;
  const kept: CivitaiImage[] = [];
  let lastMeta: ImagesResponse["metadata"] = null;
  const seen = new Set<number>();

  while (pages < MAX_FILL_PAGES) {
    const response = await fetchCivitaiImages({
      ...baseParams,
      cursor,
    });
    pages += 1;
    lastMeta = response.metadata;

    for (const item of response.items ?? []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (matchesMode(item, mode)) {
        kept.push(item);
      }
    }

    const next = response.metadata?.nextCursor ?? undefined;
    if (!next || mode === "all" || kept.length >= TARGET_VISIBLE) {
      return { items: response.items, metadata: lastMeta, kept };
    }
    cursor = next;
  }

  return { items: [], metadata: lastMeta, kept };
}

export function useImagesQuery() {
  const filters = useFilterStore();
  const apiToken = useSettingsStore((s) => s.apiToken);

  const queryKey = useMemo(
    () => [
      "images",
      filters.sort,
      filters.period,
      filters.nsfw,
      filters.username,
      filters.modelId,
      filters.modelVersionId,
      filters.baseModels,
      filters.workflowMode,
      apiToken,
    ],
    [filters, apiToken],
  );

  return useInfiniteQuery<
    ImagesResponse & { kept: CivitaiImage[] },
    Error,
    InfiniteData<ImagesResponse & { kept: CivitaiImage[] }>,
    typeof queryKey,
    string | undefined
  >({
    queryKey,
    initialPageParam: undefined,
    queryFn: ({ pageParam }) =>
      fetchWithSmartFill(
        buildFetchParams(filters, apiToken, pageParam),
        filters.workflowMode,
        pageParam,
      ),
    getNextPageParam: (lastPage) =>
      lastPage.metadata?.nextCursor ?? undefined,
  });
}

export function flattenImages(
  data?: InfiniteData<ImagesResponse & { kept: CivitaiImage[] }>,
) {
  if (!data) return [] as CivitaiImage[];
  const seen = new Set<number>();
  const out: CivitaiImage[] = [];
  for (const page of data.pages) {
    for (const item of page.kept) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}
