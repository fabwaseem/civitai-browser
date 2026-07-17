import { useCallback, useRef } from "react";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { ensureCachedImage, ensurePreviewImage } from "@/api/tauri";
import { previewImageUrl } from "@/api/classifier";
import { comfyExportArgs } from "@/api/comfyExport";
import type { CivitaiImage } from "@/api/types";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";

const previewReady = new Set<number>();
const originalReady = new Set<number>();
const previewInflight = new Set<number>();
const originalInflight = new Set<number>();

async function warmPreview(image: CivitaiImage, apiToken?: string) {
  if (previewReady.has(image.id) || previewInflight.has(image.id)) return;
  previewInflight.add(image.id);
  try {
    await ensurePreviewImage({
      imageId: image.id,
      url: previewImageUrl(image, 120),
      apiToken,
    });
    previewReady.add(image.id);
  } catch {
    /* ignore */
  } finally {
    previewInflight.delete(image.id);
  }
}

async function warmOriginal(image: CivitaiImage, apiToken?: string) {
  if (originalReady.has(image.id) || originalInflight.has(image.id)) return;
  originalInflight.add(image.id);
  try {
    await ensureCachedImage(comfyExportArgs(image, apiToken));
    originalReady.add(image.id);
  } catch {
    /* ignore */
  } finally {
    originalInflight.delete(image.id);
  }
}

export function useImageDrag(_images: CivitaiImage[]) {
  const apiToken = useSettingsStore((s) => s.apiToken);
  const setPreparingId = useUiStore((s) => s.setPreparingId);
  const tokenRef = useRef(apiToken);
  tokenRef.current = apiToken;

  /** Hover: tiny drag-icon only — never originals (they starve gallery loads). */
  const prefetchImage = useCallback(
    (image: CivitaiImage) => {
      void warmPreview(image, apiToken || undefined);
    },
    [apiToken],
  );

  /** Selection: prepare Comfy-ready original in the background. */
  const prepareSelected = useCallback(
    (image: CivitaiImage) => {
      void warmPreview(image, apiToken || undefined);
      void warmOriginal(image, apiToken || undefined);
    },
    [apiToken],
  );

  const beginDrag = useCallback(
    async (image: CivitaiImage) => {
      const ready =
        previewReady.has(image.id) && originalReady.has(image.id);
      if (!ready) setPreparingId(image.id);
      try {
        const [preview, original] = await Promise.all([
          ensurePreviewImage({
            imageId: image.id,
            url: previewImageUrl(image, 120),
            apiToken: apiToken || undefined,
          }),
          ensureCachedImage(comfyExportArgs(image, apiToken || undefined)),
        ]);
        previewReady.add(image.id);
        originalReady.add(image.id);

        await startDrag({
          item: [original.path],
          icon: preview.path,
        });
      } finally {
        setPreparingId(null);
      }
    },
    [apiToken, setPreparingId],
  );

  return { beginDrag, prefetchImage, prepareSelected };
}
