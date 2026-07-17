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
import { ImageCard } from "@/components/ImageCard";
import { GallerySkeleton } from "@/components/GallerySkeleton";
import type { CivitaiImage } from "@/api/types";
import type { ViewMode } from "@/stores/ui";

const GAP = 2;
const MIN_COLUMN_WIDTH = 300;
const MAX_COLUMNS = 5;

interface GalleryProps {
  images: CivitaiImage[];
  viewMode: ViewMode;
  layoutKey: string;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  onSelect: (image: CivitaiImage) => void;
  onDragStart: (image: CivitaiImage) => void;
  onHover: (image: CivitaiImage) => void;
}

export function Gallery({
  images,
  viewMode,
  layoutKey,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  onSelect,
  onDragStart,
  onHover,
}: GalleryProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

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
      data: CivitaiImage;
      width: number;
    }) => (
      <ImageCard
        data={data}
        width={width}
        variant="masonry"
        onSelect={onSelect}
        onDragStart={onDragStart}
        onHover={onHover}
      />
    ),
    [onDragStart, onHover, onSelect],
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
    >
      {viewMode === "masonry" && viewport.width > 0 && (
        <MasonryGallery
          key={layoutKey}
          images={images}
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
              onDragStart={onDragStart}
              onHover={onHover}
            />
          ))}
        </div>
      )}
      {isFetchingNextPage && (
        <GallerySkeleton
          viewMode={viewMode}
          count={viewMode === "grid" ? 5 : 6}
          className="mt-[2px]"
        />
      )}
    </div>
  );
}

function layoutColumns(containerWidth: number) {
  const cols = Math.min(
    MAX_COLUMNS,
    Math.max(1, Math.floor((containerWidth + GAP) / (MIN_COLUMN_WIDTH + GAP))),
  );
  const columnWidth = Math.floor((containerWidth - GAP * (cols - 1)) / cols);
  // Exact width the positioner should use so no leftover pixels sit between columns
  const usedWidth = cols * columnWidth + GAP * (cols - 1);
  return { cols, columnWidth, usedWidth };
}

function MasonryGallery({
  images,
  width,
  height,
  scrollTop,
  renderItem,
  onRender,
}: {
  images: CivitaiImage[];
  width: number;
  height: number;
  scrollTop: number;
  renderItem: (props: {
    index: number;
    data: CivitaiImage;
    width: number;
  }) => ReactElement;
  onRender: (
    startIndex: number,
    stopIndex: number,
    items: CivitaiImage[],
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
    items: images,
    height: Math.max(height, 1),
    scrollTop,
    overscanBy: 2,
    itemHeightEstimate: Math.round(columnWidth * 1.35),
    itemKey: (item, index) => item?.id ?? index,
    // Kill inline baseline strut that adds phantom vertical space under cards
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
