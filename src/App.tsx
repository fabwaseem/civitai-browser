import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FilterBar } from "@/components/FilterBar";
import { Gallery } from "@/components/Gallery";
import { GallerySkeleton } from "@/components/GallerySkeleton";
import { DetailPanel } from "@/components/DetailPanel";
import { SettingsDialog } from "@/components/SettingsDialog";
import { DownloadsPanel } from "@/components/DownloadsPanel";
import { DownloadFlyLayer } from "@/components/DownloadFlyLayer";
import { TitleBar } from "@/components/TitleBar";
import { UpdateChecker } from "@/components/UpdateChecker";
import { AppToaster, notify } from "@/lib/toast";
import { flattenImages, useImagesQuery } from "@/api/queries";
import { useImageDrag } from "@/hooks/useImageDrag";
import { useSettingsStore } from "@/stores/settings";
import { useFilterStore } from "@/stores/filters";
import { useUiStore } from "@/stores/ui";
import { useDownloadStore } from "@/stores/downloads";
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
  const filtersHydrated = useFilterStore((s) => s.hydrated);
  const hydrateFilters = useFilterStore((s) => s.hydrate);
  const hydrateUi = useUiStore((s) => s.hydrate);
  const filters = useFilterStore();
  const viewMode = useUiStore((s) => s.viewMode);
  const selectedId = useUiStore((s) => s.selectedId);
  const setSelectedId = useUiStore((s) => s.setSelectedId);

  const [selected, setSelected] = useState<CivitaiImage | null>(null);
  const downloadsOpen = useDownloadStore((s) => s.panelOpen);
  const setDownloadsOpen = useDownloadStore((s) => s.setPanelOpen);
  const ensureDownloadListener = useDownloadStore((s) => s.ensureListener);
  const openSettings = useUiStore((s) => s.openSettings);

  useEffect(() => {
    void (async () => {
      await hydrate();
      await hydrateFilters();
      await hydrateUi();
    })();
  }, [hydrate, hydrateFilters, hydrateUi]);

  useEffect(() => {
    void ensureDownloadListener();
  }, [ensureDownloadListener]);

  const ready = hydrated && filtersHydrated;
  const query = useImagesQuery();
  const images = useMemo(() => flattenImages(query.data), [query.data]);
  const { beginDrag, prefetchImage, prepareSelected } = useImageDrag(images);

  useEffect(() => {
    if (!query.isError) return;
    notify.error(
      (query.error as Error)?.message || "Failed to load images",
      { id: "gallery-load-error" },
    );
  }, [query.isError, query.error]);

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

  if (!ready) {
    return (
      <div className="grid h-full place-items-center text-sm text-[var(--color-muted)]">
        Loading settings…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <AppToaster />
      <UpdateChecker />
      <DownloadFlyLayer />
      <TitleBar
        sidebarOpen={!!selected}
        resultCount={images.length}
        isFetching={query.isFetching}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section className="flex min-w-0 flex-1 flex-col">
          <FilterBar
            onRefresh={() => void query.refetch()}
            onOpenSettings={() => openSettings()}
            onOpenDownloads={() => setDownloadsOpen(true)}
            isFetching={query.isFetching}
          />

          <main className="min-h-0 flex-1">
            {query.isLoading ? (
              <div className="h-full overflow-hidden">
                <GallerySkeleton viewMode={viewMode} />
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
      </div>

      <SettingsDialog />
      <DownloadsPanel open={downloadsOpen} onOpenChange={setDownloadsOpen} />
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
