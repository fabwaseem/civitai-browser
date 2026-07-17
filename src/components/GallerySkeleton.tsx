import type { CSSProperties } from "react";
import type { ViewMode } from "@/stores/ui";
import { cn } from "@/lib/utils";

export const SKELETON_GAP = 2;

/** Varied aspect stubs so masonry skeleton feels like real cards. */
export const MASONRY_SKELETON_HEIGHTS = [
  280, 360, 220, 400, 300, 340, 250, 380, 290, 320, 240, 410, 270, 350, 230,
  390, 310, 260, 370, 295,
];

interface GallerySkeletonProps {
  viewMode: ViewMode;
  /** Fewer tiles for bottom “load more” strip */
  count?: number;
  className?: string;
}

/** Full-gallery loading state (initial fetch). */
export function GallerySkeleton({
  viewMode,
  count,
  className,
}: GallerySkeletonProps) {
  const n = count ?? (viewMode === "grid" ? 20 : MASONRY_SKELETON_HEIGHTS.length);

  if (viewMode === "grid") {
    return (
      <div
        className={cn(
          "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5",
          className,
        )}
        style={{ gap: SKELETON_GAP }}
        aria-busy="true"
        aria-label="Loading images"
      >
        {Array.from({ length: n }, (_, i) => (
          <SkeletonTile key={i} className="aspect-square" />
        ))}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "columns-2 sm:columns-3 md:columns-4 xl:columns-5",
        className,
      )}
      style={{ columnGap: SKELETON_GAP }}
      aria-busy="true"
      aria-label="Loading images"
    >
      {Array.from({ length: n }, (_, i) => (
        <SkeletonTile
          key={i}
          className="mb-[2px] w-full break-inside-avoid"
          style={{
            height: MASONRY_SKELETON_HEIGHTS[i % MASONRY_SKELETON_HEIGHTS.length],
          }}
        />
      ))}
    </div>
  );
}

export function SkeletonTile({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn("skeleton-shimmer rounded-sm bg-white/[0.06]", className)}
      style={style}
      aria-hidden
    />
  );
}
