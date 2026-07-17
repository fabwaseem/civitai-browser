import { useEffect, useRef, useState } from "react";
import { Heart, MessageCircle } from "lucide-react";
import { BlurPlaceholder } from "@/components/BlurPlaceholder";
import { galleryImageUrl } from "@/api/classifier";
import type { CivitaiImage } from "@/api/types";
import { formatCount, cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

/** Fixed CDN size — better cache hits, fast gallery paint. */
const GALLERY_WIDTH = 450;

/** Survives masonry remounts so we don't re-flash blurhash. */
const loadedIds = new Set<number>();

interface ImageCardProps {
  data: CivitaiImage;
  width?: number;
  variant?: "masonry" | "grid";
  onSelect: (image: CivitaiImage) => void;
  onDragStart: (image: CivitaiImage) => void;
  onHover?: (image: CivitaiImage) => void;
}

export function ImageCard({
  data,
  width,
  variant = "masonry",
  onSelect,
  onDragStart,
  onHover,
}: ImageCardProps) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(() => loadedIds.has(data.id));
  const selected = useUiStore((s) => s.selectedId === data.id);
  const src = galleryImageUrl(data, GALLERY_WIDTH);
  const masonryHeight =
    variant === "masonry" && width != null && data.width > 0
      ? Math.max(1, Math.round((width * data.height) / data.width))
      : undefined;

  useEffect(() => {
    setLoaded(loadedIds.has(data.id));
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      loadedIds.add(data.id);
      setLoaded(true);
    }
  }, [data.id, src]);

  function markLoaded() {
    loadedIds.add(data.id);
    setLoaded(true);
  }

  return (
    <button
      type="button"
      draggable
      onMouseEnter={() => onHover?.(data)}
      onPointerDown={() => onHover?.(data)}
      onDragStart={(e) => {
        e.preventDefault();
        void onDragStart(data);
      }}
      onClick={() => onSelect(data)}
      className={cn(
        // block + p-0 kills UA button padding and baseline gap under the card
        "group relative m-0 block w-full appearance-none border-0 p-0 text-left",
        "overflow-hidden rounded-sm bg-black/30",
        selected && "outline outline-2 outline-[var(--color-accent)] -outline-offset-2",
        variant === "grid" && "aspect-square",
      )}
      style={masonryHeight != null ? { height: masonryHeight, width: "100%" } : undefined}
    >
      {!loaded && <BlurPlaceholder hash={data.hash} />}

      <img
        ref={imgRef}
        src={src}
        alt=""
        width={data.width}
        height={data.height}
        decoding="async"
        onLoad={markLoaded}
        onError={markLoaded}
        className={cn(
          "pointer-events-none block h-full w-full object-cover transition-opacity duration-200",
          loaded ? "opacity-100" : "opacity-0",
        )}
        draggable={false}
      />

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 to-transparent p-1.5 pt-6 opacity-0 transition group-hover:opacity-100">
        <div className="flex items-center justify-between text-[10px] text-white/90">
          <span className="truncate">@{data.username ?? "unknown"}</span>
          <span className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-0.5">
              <Heart className="h-3 w-3" />
              {formatCount(data.stats?.heartCount ?? data.stats?.likeCount)}
            </span>
            <span className="inline-flex items-center gap-0.5">
              <MessageCircle className="h-3 w-3" />
              {formatCount(data.stats?.commentCount)}
            </span>
          </span>
        </div>
      </div>

    </button>
  );
}
