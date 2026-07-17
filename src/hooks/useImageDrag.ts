import { useCallback, useEffect, useRef } from "react";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { ensureDragReady, lookupDragReady } from "@/api/tauri";
import { comfyExportArgs } from "@/api/comfyExport";
import type { CivitaiImage } from "@/api/types";
import { useSettingsStore } from "@/stores/settings";

type ReadyPaths = { original: string; preview: string };

const ready = new Map<number, ReadyPaths>();
const inflight = new Map<number, Promise<ReadyPaths | null>>();

/** Parallel downloads so the gallery fills the drag cache quickly. */
const MAX_CONCURRENT = 6;
let active = 0;
const queue: Array<() => void> = [];

function pumpQueue() {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const next = queue.shift();
    next?.();
  }
}

function enqueueWarm(run: () => Promise<void>, priority = false) {
  return new Promise<void>((resolve) => {
    const start = () => {
      active += 1;
      void run().finally(() => {
        active -= 1;
        resolve();
        pumpQueue();
      });
    };
    if (priority) {
      queue.unshift(start);
    } else {
      queue.push(start);
    }
    pumpQueue();
  });
}

async function resolveReady(
  image: CivitaiImage,
  apiToken?: string,
): Promise<ReadyPaths | null> {
  const existing = ready.get(image.id);
  if (existing) return existing;

  const pending = inflight.get(image.id);
  if (pending) return pending;

  const job = (async () => {
    try {
      const result = await ensureDragReady(comfyExportArgs(image, apiToken));
      const paths = { original: result.original, preview: result.preview };
      ready.set(image.id, paths);
      return paths;
    } catch {
      return null;
    } finally {
      inflight.delete(image.id);
    }
  })();

  inflight.set(image.id, job);
  return job;
}

function warmImage(image: CivitaiImage, apiToken?: string, priority = false) {
  if (ready.has(image.id) || inflight.has(image.id)) return;
  // Hover/select bypasses the queue so the pointer target finishes first.
  if (priority) {
    void resolveReady(image, apiToken);
    return;
  }
  void enqueueWarm(async () => {
    await resolveReady(image, apiToken);
  }, false);
}

export function useImageDrag(images: CivitaiImage[]) {
  const apiToken = useSettingsStore((s) => s.apiToken);
  const tokenRef = useRef(apiToken);
  tokenRef.current = apiToken;
  const imagesRef = useRef(images);
  imagesRef.current = images;

  // 1) Hydrate from disk cache instantly
  // 2) Concurrently download everything else into cache
  useEffect(() => {
    if (images.length === 0) return;
    let cancelled = false;
    const token = tokenRef.current || undefined;
    const ids = images.map((img) => img.id);

    void (async () => {
      try {
        const hits = await lookupDragReady(ids);
        if (cancelled) return;
        for (const hit of hits) {
          ready.set(hit.imageId, {
            original: hit.original,
            preview: hit.preview,
          });
        }
      } catch {
        /* ignore lookup failures */
      }

      if (cancelled) return;
      // Download all not-yet-ready images with concurrency
      for (const image of imagesRef.current) {
        if (cancelled) break;
        warmImage(image, token, false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [images]);

  /** Hover / pointer-down: jump the queue. */
  const prefetchImage = useCallback(
    (image: CivitaiImage) => {
      warmImage(image, apiToken || undefined, true);
    },
    [apiToken],
  );

  const prepareSelected = useCallback(
    (image: CivitaiImage) => {
      warmImage(image, apiToken || undefined, true);
    },
    [apiToken],
  );

  const beginDrag = useCallback(
    async (image: CivitaiImage) => {
      const cached = ready.get(image.id);
      if (cached) {
        await startDrag({
          item: [cached.original],
          icon: cached.preview,
        });
        return;
      }

      // Rare miss — wait for in-flight warm or start one now
      const paths = await resolveReady(image, apiToken || undefined);
      if (!paths) return;
      await startDrag({
        item: [paths.original],
        icon: paths.preview,
      });
    },
    [apiToken],
  );

  return { beginDrag, prefetchImage, prepareSelected };
}
