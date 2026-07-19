import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  useInfiniteLoader,
  useMasonry,
  usePositioner,
  useResizeObserver,
} from "masonic";
import { Loader2 } from "lucide-react";
import { ImageCard } from "@/components/ImageCard";
import type { CivitaiImage } from "@/api/types";
import type { ViewMode } from "@/stores/ui";

const GAP = 2;
const MIN_COLUMN_WIDTH = 300;
const MAX_COLUMNS = 5;

type MasonryEntry = { id: number; image: CivitaiImage };

interface GalleryProps {
  images: CivitaiImage[];
  viewMode: ViewMode;
  layoutKey: string;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onSelect: (image: CivitaiImage) => void;
  onOpenLightbox: (image: CivitaiImage) => void;
  onDragStart: (image: CivitaiImage) => void;
  onHover: (image: CivitaiImage) => void;
}

/**
 * Masonic caches cell positions by index and crashes if `items` shrinks
 * without recreating the positioner. Bump a generation whenever the list
 * gets shorter so we remount cleanly (filter refresh, fewer results, etc.).
 */
function useMasonryRemountKey(layoutKey: string, itemCount: number) {
  const generationRef = useRef(0);
  const prevLayoutKeyRef = useRef(layoutKey);
  const prevCountRef = useRef(itemCount);

  if (layoutKey !== prevLayoutKeyRef.current) {
    generationRef.current = 0;
    prevLayoutKeyRef.current = layoutKey;
  } else if (itemCount < prevCountRef.current) {
    generationRef.current += 1;
  }
  prevCountRef.current = itemCount;

  return `${layoutKey}:${generationRef.current}`;
}

export function Gallery({
  images,
  viewMode,
  layoutKey,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onSelect,
  onOpenLightbox,
  onDragStart,
  onHover,
}: GalleryProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  // Images only — never splice skeletons into masonic's items array.
  // Removing skeletons used to shorten the list mid-flight and crash masonic.
  const masonryItems = useMemo(
    (): MasonryEntry[] =>
      images.map((image) => ({
        id: image.id,
        image,
      })),
    [images],
  );

  const masonryKey = useMasonryRemountKey(layoutKey, masonryItems.length);

  const maybeLoadMore = useInfiniteLoader(
    async () => {
      if (hasNextPage && !isFetchingNextPage) onLoadMore();
    },
    {
      isItemLoaded: (index, items) => !!items[index],
      threshold: 12,
    },
  );

  const renderItem = useCallback(
    ({
      data,
      width,
    }: {
      index: number;
      data: MasonryEntry;
      width: number;
    }) => {
      if (!data?.image) return <div style={{ width, height: 1 }} />;
      return (
        <ImageCard
          data={data.image}
          width={width}
          variant="masonry"
          onSelect={onSelect}
          onOpenLightbox={onOpenLightbox}
          onDragStart={onDragStart}
          onHover={onHover}
        />
      );
    },
    [onDragStart, onHover, onOpenLightbox, onSelect],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const syncSize = () => {
      setViewport({ width: el.clientWidth, height: el.clientHeight });
    };
    syncSize();

    const ro = new ResizeObserver(syncSize);
    ro.observe(el);

    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setScrollTop(el.scrollTop);
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 900) {
          if (hasNextPage && !isFetchingNextPage) onLoadMore();
        }
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", onScroll);
    };
  }, [hasNextPage, isFetchingNextPage, onLoadMore, layoutKey, viewMode]);

  if (images.length === 0) {
    return (
      <div className="grid h-full place-items-center px-6 text-sm text-[var(--color-muted)]">
        No images match these filters. Try “All” or widen the period.
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-x-hidden overflow-y-auto overscroll-contain"
      aria-busy={isFetchingNextPage || undefined}
    >
      {viewMode === "masonry" && viewport.width > 0 && (
        <MasonryGallery
          key={masonryKey}
          items={masonryItems}
          width={viewport.width}
          height={viewport.height}
          scrollTop={scrollTop}
          renderItem={renderItem}
          onRender={maybeLoadMore}
        />
      )}
      {viewMode === "grid" && (
        <div
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"
          style={{ gap: GAP }}
        >
          {images.map((image) => (
            <ImageCard
              key={image.id}
              data={image}
              variant="grid"
              onSelect={onSelect}
              onOpenLightbox={onOpenLightbox}
              onDragStart={onDragStart}
              onHover={onHover}
            />
          ))}
        </div>
      )}
      {isFetchingNextPage && <LoadMoreFooter />}
    </div>
  );
}

function LoadMoreFooter() {
  return (
    <div
      className="flex items-center justify-center gap-2 py-6 text-sm text-[var(--color-muted)]"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-4 w-4 animate-spin text-[var(--color-accent)]" />
      Loading more
    </div>
  );
}

function layoutColumns(containerWidth: number) {
  const cols = Math.min(
    MAX_COLUMNS,
    Math.max(1, Math.floor((containerWidth + GAP) / (MIN_COLUMN_WIDTH + GAP))),
  );
  const columnWidth = Math.floor((containerWidth - GAP * (cols - 1)) / cols);
  const usedWidth = cols * columnWidth + GAP * (cols - 1);
  return { cols, columnWidth, usedWidth };
}

function MasonryGallery({
  items,
  width,
  height,
  scrollTop,
  renderItem,
  onRender,
}: {
  items: MasonryEntry[];
  width: number;
  height: number;
  scrollTop: number;
  renderItem: (props: {
    index: number;
    data: MasonryEntry;
    width: number;
  }) => ReactElement;
  onRender: (
    startIndex: number,
    stopIndex: number,
    items: MasonryEntry[],
  ) => void;
}) {
  const { cols, columnWidth, usedWidth } = useMemo(
    () => layoutColumns(width),
    [width],
  );

  const positioner = usePositioner(
    {
      width: usedWidth,
      columnWidth,
      columnCount: cols,
      columnGutter: GAP,
      rowGutter: GAP,
    },
    [usedWidth, columnWidth, cols],
  );
  const resizeObserver = useResizeObserver(positioner);

  return useMasonry({
    positioner,
    resizeObserver,
    items,
    height: Math.max(height, 1),
    scrollTop,
    overscanBy: 2,
    itemHeightEstimate: Math.round(columnWidth * 1.35),
    itemKey: (item, index) => item?.id ?? index,
    itemStyle: {
      margin: 0,
      padding: 0,
      border: 0,
      fontSize: 0,
      lineHeight: 0,
      overflow: "hidden",
    },
    onRender,
    render: renderItem,
  });
}
