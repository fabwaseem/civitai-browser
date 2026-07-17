import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FilterBar } from "@/components/FilterBar";
import { Gallery } from "@/components/Gallery";
import { DetailPanel } from "@/components/DetailPanel";
import { SettingsDialog } from "@/components/SettingsDialog";
import { UpdateChecker } from "@/components/UpdateChecker";
import { flattenImages, useImagesQuery } from "@/api/queries";
import { useImageDrag } from "@/hooks/useImageDrag";
import { useSettingsStore } from "@/stores/settings";
import { useFilterStore } from "@/stores/filters";
import { useUiStore } from "@/stores/ui";
import type { CivitaiImage } from "@/api/types";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    },
  },
});

function BrowserShell() {
  const hydrated = useSettingsStore((s) => s.hydrated);
  const hydrate = useSettingsStore((s) => s.hydrate);
  const defaultNsfw = useSettingsStore((s) => s.defaultNsfw);
  const setNsfw = useFilterStore((s) => s.setNsfw);
  const filters = useFilterStore();
  const viewMode = useUiStore((s) => s.viewMode);
  const selectedId = useUiStore((s) => s.selectedId);
  const setSelectedId = useUiStore((s) => s.setSelectedId);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState<CivitaiImage | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (hydrated) setNsfw(defaultNsfw);
  }, [defaultNsfw, hydrated, setNsfw]);

  const query = useImagesQuery();
  const images = useMemo(() => flattenImages(query.data), [query.data]);
  const { beginDrag, prefetchImage, prepareSelected } = useImageDrag(images);

  const layoutKey = useMemo(
    () =>
      [
        filters.sort,
        filters.period,
        filters.nsfw,
        filters.username,
        filters.modelId,
        filters.modelVersionId,
        filters.baseModels,
        filters.workflowMode,
      ].join("|"),
    [filters],
  );

  useEffect(() => {
    setSelected(null);
    setSelectedId(null);
  }, [layoutKey, setSelectedId]);

  // Keep detail panel image object in sync when the list refreshes
  useEffect(() => {
    if (selectedId == null) {
      setSelected(null);
      return;
    }
    const match = images.find((img) => img.id === selectedId);
    if (match) setSelected(match);
  }, [images, selectedId]);

  function handleSelect(image: CivitaiImage) {
    setSelected(image);
    setSelectedId(image.id);
    prepareSelected(image);
  }

  if (!hydrated) {
    return (
      <div className="grid h-full place-items-center text-sm text-[var(--color-muted)]">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <UpdateChecker />

      <section className="flex min-w-0 flex-1 flex-col">
        <FilterBar
          onRefresh={() => void query.refetch()}
          onOpenSettings={() => setSettingsOpen(true)}
          isFetching={query.isFetching}
          resultCount={images.length}
        />

        <main className="min-h-0 flex-1">
          {query.isLoading ? (
            <div className="grid h-full place-items-center text-sm text-[var(--color-muted)]">
              Fetching images from Civitai…
            </div>
          ) : query.isError ? (
            <div className="grid h-full place-items-center gap-2 px-6 text-center text-sm">
              <p className="text-[var(--color-danger)]">
                {(query.error as Error).message}
              </p>
              <button
                type="button"
                className="text-[var(--color-accent)] underline"
                onClick={() => void query.refetch()}
              >
                Retry
              </button>
            </div>
          ) : (
            <Gallery
              images={images}
              viewMode={viewMode}
              layoutKey={layoutKey}
              hasNextPage={!!query.hasNextPage}
              isFetchingNextPage={query.isFetchingNextPage}
              onLoadMore={() => void query.fetchNextPage()}
              onSelect={handleSelect}
              onDragStart={beginDrag}
              onHover={prefetchImage}
            />
          )}
        </main>
      </section>

      <DetailPanel
        image={selected}
        onClose={() => {
          setSelected(null);
          setSelectedId(null);
        }}
        onDragStart={beginDrag}
      />

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserShell />
    </QueryClientProvider>
  );
}
