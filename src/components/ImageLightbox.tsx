import { useEffect, useMemo } from "react";
import Lightbox, { type SlideImage } from "yet-another-react-lightbox";
import Counter from "yet-another-react-lightbox/plugins/counter";
import Fullscreen from "yet-another-react-lightbox/plugins/fullscreen";
import Slideshow from "yet-another-react-lightbox/plugins/slideshow";
import Thumbnails from "yet-another-react-lightbox/plugins/thumbnails";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/counter.css";
import "yet-another-react-lightbox/plugins/thumbnails.css";
import {
  galleryImageUrl,
  lightboxImageUrl,
} from "@/api/classifier";
import type { CivitaiImage } from "@/api/types";

const LIGHTBOX_WIDTHS = [640, 960, 1280, 1920, 2560] as const;

/** Avoid re-hitting the CDN for URLs we've already kicked off. */
const prefetchedUrls = new Set<string>();

type LightboxSlide = SlideImage & {
  thumbnail?: string;
};

function prefetchUrl(url: string | undefined) {
  if (!url || prefetchedUrls.has(url)) return;
  prefetchedUrls.add(url);
  const img = new window.Image();
  img.decoding = "async";
  img.src = url;
}

function wrapIndex(index: number, length: number) {
  return ((index % length) + length) % length;
}

function buildSrcSet(image: CivitaiImage): SlideImage["srcSet"] {
  const w = Math.max(1, image.width || 1);
  const h = Math.max(1, image.height || 1);
  const maxW = Math.max(w, 640);
  return LIGHTBOX_WIDTHS.filter((size) => size <= maxW + 200).map((size) => {
    const width = Math.min(size, maxW);
    return {
      src: lightboxImageUrl(image, width),
      width,
      height: Math.max(1, Math.round((width * h) / w)),
    };
  });
}

function toSlide(image: CivitaiImage): LightboxSlide {
  const width = Math.max(1, image.width || 1);
  const height = Math.max(1, image.height || 1);
  const user = image.username ? `@${image.username}` : "Unknown creator";

  return {
    src: lightboxImageUrl(image, Math.min(width, 1920)),
    alt: `Image by ${user}`,
    width,
    height,
    thumbnail: galleryImageUrl(image, 320),
    srcSet: buildSrcSet(image),
  };
}

/** Prefetch full-res slide + thumb for an index (and neighbors). */
function prefetchAround(slides: LightboxSlide[], index: number) {
  if (slides.length === 0) return;
  // Current, next two, previous — next is highest priority for swipe-ahead.
  for (const offset of [0, 1, 2, -1]) {
    const slide = slides[wrapIndex(index + offset, slides.length)];
    prefetchUrl(slide.src);
    prefetchUrl(slide.thumbnail);
  }
}

interface ImageLightboxProps {
  images: CivitaiImage[];
  index: number;
  open: boolean;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onNearEnd?: () => void;
}

export function ImageLightbox({
  images,
  index,
  open,
  onClose,
  onIndexChange,
  onNearEnd,
}: ImageLightboxProps) {
  const slides = useMemo(() => images.map(toSlide), [images]);

  useEffect(() => {
    if (!open || slides.length === 0) return;
    const current = Math.min(Math.max(index, 0), slides.length - 1);
    prefetchAround(slides, current);
  }, [open, slides, index]);

  if (!open || slides.length === 0) return null;

  const safeIndex = Math.min(Math.max(index, 0), slides.length - 1);

  return (
    <Lightbox
      open={open}
      close={onClose}
      index={safeIndex}
      slides={slides}
      plugins={[Zoom, Thumbnails, Counter, Fullscreen, Slideshow]}
      carousel={{
        finite: false,
        preload: 3,
        padding: "16px",
        spacing: "12%",
        imageFit: "contain",
      }}
      animation={{ fade: 220, swipe: 320 }}
      controller={{ closeOnBackdropClick: true, closeOnPullDown: true }}
      zoom={{
        maxZoomPixelRatio: 3,
        scrollToZoom: true,
        doubleClickDelay: 280,
      }}
      thumbnails={{
        position: "bottom",
        width: 84,
        height: 64,
        border: 0,
        borderRadius: 4,
        padding: 0,
        gap: 6,
        imageFit: "cover",
        vignette: true,
        showToggle: true,
      }}
      counter={{ container: { style: { top: "unset", bottom: 0 } } }}
      slideshow={{ autoplay: false, delay: 3500 }}
      styles={{
        container: {
          backgroundColor: "rgba(4, 8, 7, 0.94)",
        },
      }}
      on={{
        view: ({ index: next }) => {
          onIndexChange(next);
          prefetchAround(slides, next);
          if (next >= images.length - 4) onNearEnd?.();
        },
      }}
    />
  );
}
