import { useEffect, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { FilterBar } from "@/components/FilterBar";
import { Gallery } from "@/components/Gallery";
import { GallerySkeleton } from "@/components/GallerySkeleton";
import { GalleryError } from "@/components/GalleryError";
import { ImageLightbox } from "@/components/ImageLightbox";
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
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const downloadsOpen = useDownloadStore((s) => s.panelOpen);
  const setDownloadsOpen = useDownloadStore((s) => s.setPanelOpen);
  const ensureDownloadListener = useDownloadStore((s) => s.ensureListener);
  const openSettings = useUiStore((s) => s.openSettings);

  const lightboxOpen = lightboxIndex >= 0;

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
    if (!query.isError || images.length > 0) return;
    const msg = (query.error as Error)?.message?.trim();
    if (!msg) return; // empty HMR blips — UI already explains
    notify.error(msg, { id: "gallery-load-error" });
  }, [query.isError, query.error, images.length]);

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
        filters.tagIds.join(","),
        filters.workflowMode,
      ].join("|"),
    [filters],
  );

  useEffect(() => {
    setSelected(null);
    setSelectedId(null);
    setLightboxIndex(-1);
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

  // Clamp lightbox index if the list shrinks while open
  useEffect(() => {
    if (lightboxIndex < 0) return;
    if (images.length === 0) {
      setLightboxIndex(-1);
      return;
    }
    if (lightboxIndex >= images.length) {
      setLightboxIndex(images.length - 1);
    }
  }, [images.length, lightboxIndex]);

  function handleSelect(image: CivitaiImage) {
    setSelected(image);
    setSelectedId(image.id);
    prepareSelected(image);
  }

  function handleOpenLightbox(image: CivitaiImage) {
    const idx = images.findIndex((img) => img.id === image.id);
    if (idx < 0) return;
    setLightboxIndex(idx);
  }

  function handleLightboxIndexChange(next: number) {
    setLightboxIndex(next);
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
            <AppErrorBoundary key={layoutKey} label="Gallery crashed">
              {query.isLoading && images.length === 0 ? (
                <div className="h-full overflow-hidden">
                  <GallerySkeleton viewMode={viewMode} />
                </div>
              ) : query.isError && images.length === 0 ? (
                <GalleryError
                  error={query.error}
                  busy={query.isFetching}
                  onRetry={() => void query.refetch()}
                />
              ) : (
                <Gallery
                  images={images}
                  viewMode={viewMode}
                  layoutKey={layoutKey}
                  hasNextPage={!!query.hasNextPage}
                  isFetchingNextPage={query.isFetchingNextPage}
                  onLoadMore={() => void query.fetchNextPage()}
                  onSelect={handleSelect}
                  onOpenLightbox={handleOpenLightbox}
                  onDragStart={beginDrag}
                  onHover={prefetchImage}
                />
              )}
            </AppErrorBoundary>
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

      <ImageLightbox
        images={images}
        index={lightboxIndex}
        open={lightboxOpen}
        onClose={() => setLightboxIndex(-1)}
        onIndexChange={handleLightboxIndexChange}
        onNearEnd={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) {
            void query.fetchNextPage();
          }
        }}
      />

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
