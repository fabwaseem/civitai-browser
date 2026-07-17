import { useState, type ReactNode } from "react";
import { Copy, Download, ExternalLink, Workflow, X } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { Button } from "@/components/ui/button";
import {
  extractComfyBundle,
  extractNegativePrompt,
  extractPrompt,
  extractWorkflowJson,
  galleryImageUrl,
  getMetaKind,
} from "@/api/classifier";
import { comfyExportArgs } from "@/api/comfyExport";
import { saveImage } from "@/api/tauri";
import type { CivitaiImage } from "@/api/types";
import { useSettingsStore } from "@/stores/settings";
import { formatCount } from "@/lib/utils";

interface DetailPanelProps {
  image: CivitaiImage | null;
  preparing: boolean;
  onClose: () => void;
  onDragStart: (image: CivitaiImage) => void;
}

export function DetailPanel({
  image,
  preparing,
  onClose,
  onDragStart,
}: DetailPanelProps) {
  const { apiToken, downloadDir, setDownloadDir } = useSettingsStore();
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!image) return null;

  const current = image;
  const kind = getMetaKind(current);
  const comfy = extractComfyBundle(current.meta);
  const prompt = extractPrompt(current.meta);
  const negative = extractNegativePrompt(current.meta);
  const workflow = extractWorkflowJson(current.meta);

  async function copyText(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setStatus(`${label} copied`);
  }

  async function handleDownload() {
    setBusy(true);
    setStatus(null);
    try {
      let dir = downloadDir;
      if (!dir) {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const picked = await open({ directory: true, multiple: false });
        if (!picked || Array.isArray(picked)) {
          setBusy(false);
          return;
        }
        dir = picked;
        await setDownloadDir(dir);
      }
      const path = await saveImage({
        ...comfyExportArgs(current, apiToken || undefined),
        destinationDir: dir,
      });
      setStatus(
        path.toLowerCase().endsWith(".png")
          ? `Saved PNG (ComfyUI-ready): ${path}`
          : `Saved to ${path}`,
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveWorkflow() {
    if (!workflow) return;
    const path = await save({
      defaultPath: `civitai-${current.id}-workflow.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;
    await writeTextFile(path, workflow);
    setStatus(`Workflow saved to ${path}`);
  }

  return (
    <aside className="glass-strong flex h-full w-[340px] shrink-0 flex-col border-y-0 border-r-0">
      <div className="flex items-start justify-between gap-2 border-b border-white/10 p-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            {kind === "workflow" && (
              <span
                title="ComfyUI workflow available"
                className="grid h-5 w-5 place-items-center rounded bg-[var(--color-workflow)]/15 text-[var(--color-workflow)]"
              >
                <Workflow className="h-3 w-3" strokeWidth={2.25} />
              </span>
            )}
            <span className="text-xs text-[var(--color-muted)]">#{current.id}</span>
          </div>
          <p className="text-sm font-medium">@{current.username ?? "unknown"}</p>
          {kind === "workflow" && (
            <p className="text-[11px] text-[var(--color-workflow)]">
              {comfy?.workflow
                ? `${Array.isArray(comfy.workflow.nodes) ? comfy.workflow.nodes.length : "?"} nodes`
                : "API prompt graph"}{" "}
              ready for ComfyUI
            </p>
          )}
          {kind === "meta" && (
            <p className="text-[11px] text-[var(--color-muted)]">
              Has prompts/settings only — not a full ComfyUI workflow
            </p>
          )}
          <p className="text-xs text-[var(--color-muted)]">
            {formatCount(current.stats?.heartCount ?? current.stats?.likeCount)} hearts ·{" "}
            {formatCount(current.stats?.commentCount)} comments
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <button
          type="button"
          draggable
          onDragStart={(e) => {
            e.preventDefault();
            void onDragStart(current);
          }}
          className="relative mb-3 block w-full overflow-hidden rounded border border-white/10 bg-black/30"
        >
          <img
            src={galleryImageUrl(current, 640)}
            alt=""
            className="max-h-56 w-full object-contain"
          />
          {preparing && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs">
              Preparing…
            </div>
          )}
        </button>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleDownload()}
            disabled={busy}
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              void openUrl(`https://civitai.com/images/${current.id}`)
            }
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Civitai
          </Button>
        </div>

        {prompt && (
          <Section
            title="Prompt"
            action={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void copyText(prompt, "Prompt")}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            }
          >
            <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--color-fg)]/90">
              {prompt}
            </pre>
          </Section>
        )}

        {negative && (
          <Section
            title="Negative"
            action={
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void copyText(negative, "Negative")}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            }
          >
            <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--color-fg)]/90">
              {negative}
            </pre>
          </Section>
        )}

        {workflow && (
          <Section
            title="Workflow JSON"
            action={
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void copyText(workflow, "Workflow")}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleSaveWorkflow()}
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
              </div>
            }
          >
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--color-muted)]">
              {workflow.slice(0, 4000)}
              {workflow.length > 4000 ? "\n…" : ""}
            </pre>
          </Section>
        )}

        {status && (
          <p className="mt-2 text-xs text-[var(--color-accent)]">{status}</p>
        )}
      </div>
    </aside>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="glass-chip mb-2.5 rounded p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}
