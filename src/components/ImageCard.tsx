import { Heart, MessageCircle, Workflow } from "lucide-react";
import { galleryImageUrl, getMetaKind } from "@/api/classifier";
import type { CivitaiImage } from "@/api/types";
import { formatCount, cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";

/** Fixed CDN size — better cache hits, fast gallery paint. */
const GALLERY_WIDTH = 320;

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
  const selected = useUiStore((s) => s.selectedId === data.id);
  const preparing = useUiStore((s) => s.preparingId === data.id);
  const kind = getMetaKind(data);
  const src = galleryImageUrl(data, GALLERY_WIDTH);
  const masonryHeight =
    width != null && data.width > 0
      ? Math.max(100, Math.round((width * data.height) / data.width))
      : undefined;

  return (
    <button
      type="button"
      draggable
      onMouseEnter={() => onHover?.(data)}
      onDragStart={(e) => {
        e.preventDefault();
        void onDragStart(data);
      }}
      onClick={() => onSelect(data)}
      className={cn(
        "group relative w-full overflow-hidden rounded text-left",
        "bg-[var(--color-bg-elevated)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]",
        selected && "shadow-[inset_0_0_0_2px_var(--color-accent)]",
        variant === "grid" && "aspect-square",
      )}
      style={variant === "masonry" ? { height: masonryHeight } : undefined}
    >
      <img
        src={src}
        alt=""
        width={data.width}
        height={data.height}
        decoding="async"
        className="h-full w-full object-cover"
        draggable={false}
      />

      {kind === "workflow" && (
        <span
          title="ComfyUI workflow available"
          className="pointer-events-none absolute left-1 top-1 grid h-5 w-5 place-items-center rounded bg-black/55 text-[var(--color-workflow)] backdrop-blur-sm"
        >
          <Workflow className="h-3 w-3" strokeWidth={2.25} />
        </span>
      )}

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

      {preparing && (
        <div className="absolute inset-0 grid place-items-center bg-black/45 text-[11px] font-medium backdrop-blur-[2px]">
          Preparing…
        </div>
      )}
    </button>
  );
}
