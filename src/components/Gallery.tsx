import {
  useCallback,
  useEffect,
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
import type { CivitaiImage } from "@/api/types";
import type { ViewMode } from "@/stores/ui";

const GUTTER = 2;
const COLUMN_WIDTH = 200;

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
        No images match these filters. Try “Has meta” or widen the period.
      </div>
    );
  }

  // Leave room for padding so the masonry never overflows horizontally
  const masonryWidth = Math.max(0, viewport.width - 8);

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-x-hidden overflow-y-auto overscroll-contain px-1 py-1"
    >
      {viewMode === "masonry" && masonryWidth > 0 && (
        <MasonryGallery
          key={layoutKey}
          images={images}
          width={masonryWidth}
          height={viewport.height}
          scrollTop={scrollTop}
          renderItem={renderItem}
          onRender={maybeLoadMore}
        />
      )}
      {viewMode === "grid" && (
        <div
          className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
          style={{ gap: GUTTER }}
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
        <div className="py-3 text-center text-[11px] text-[var(--color-muted)]">
          Loading more…
        </div>
      )}
    </div>
  );
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
  const positioner = usePositioner(
    {
      width,
      columnWidth: COLUMN_WIDTH,
      columnGutter: GUTTER,
      rowGutter: GUTTER,
    },
    [width],
  );
  const resizeObserver = useResizeObserver(positioner);

  return useMasonry({
    positioner,
    resizeObserver,
    items: images,
    height: Math.max(height, 1),
    scrollTop,
    overscanBy: 2,
    itemHeightEstimate: 280,
    itemKey: (item, index) => item?.id ?? index,
    onRender,
    render: renderItem,
  });
}
