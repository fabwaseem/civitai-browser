import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Heart, MessageCircle } from "lucide-react";
import { BlurPlaceholder } from "@/components/BlurPlaceholder";
import { galleryImageUrl } from "@/api/classifier";
import type { CivitaiImage } from "@/api/types";
import { shouldBlurNsfw } from "@/lib/nsfw";
import { formatCount, cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings";
import { useNsfwRevealStore } from "@/stores/nsfwReveal";
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
  const blurNsfw = useSettingsStore((s) => s.blurNsfw);
  const blurNsfwFrom = useSettingsStore((s) => s.blurNsfwFrom);
  const revealed = useNsfwRevealStore((s) => !!s.revealed[data.id]);
  const reveal = useNsfwRevealStore((s) => s.reveal);
  const hide = useNsfwRevealStore((s) => s.hide);

  const needsBlur = shouldBlurNsfw(data.nsfwLevel, blurNsfw, blurNsfwFrom);
  const blurred = needsBlur && !revealed;
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
      draggable={!blurred}
      onMouseEnter={() => onHover?.(data)}
      onPointerDown={() => onHover?.(data)}
      onDragStart={(e) => {
        if (blurred) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        void onDragStart(data);
      }}
      onClick={() => onSelect(data)}
      className={cn(
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
          "pointer-events-none block h-full w-full object-cover transition-[opacity,filter] duration-200",
          loaded ? "opacity-100" : "opacity-0",
          blurred && "scale-110 blur-[28px] brightness-75 saturate-50",
        )}
        draggable={false}
      />

      {blurred && (
        <span
          role="button"
          tabIndex={0}
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/35 text-[13px] leading-normal text-white"
          onClick={(e) => {
            e.stopPropagation();
            reveal(data.id);
            onSelect(data);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              reveal(data.id);
              onSelect(data);
            }
          }}
        >
          <Eye className="h-5 w-5 shrink-0 opacity-90" strokeWidth={2} />
          <span className="block text-[11px] font-medium leading-none tracking-wide">
            NSFW
          </span>
          <span className="block text-[10px] leading-none text-white/70">
            Click to reveal
          </span>
        </span>
      )}

      {needsBlur && revealed && (
        <span
          role="button"
          tabIndex={0}
          title="Hide again"
          className="absolute right-1 top-1 z-10 grid h-6 w-6 place-items-center rounded-sm bg-black/55 text-white/90 opacity-0 backdrop-blur-sm transition group-hover:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            hide(data.id);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              hide(data.id);
            }
          }}
        >
          <EyeOff className="h-3.5 w-3.5" />
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
    </button>
  );
}
