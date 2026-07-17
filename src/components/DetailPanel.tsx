import { useEffect, useState, type ReactNode } from "react";
import {
  Copy,
  Download,
  ExternalLink,
  Heart,
  MessageCircle,
  X,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { BlurPlaceholder } from "@/components/BlurPlaceholder";
import {
  extractNegativePrompt,
  extractPrompt,
  extractUsedResources,
  extractWorkflowJson,
  galleryImageUrl,
  type UsedResource,
} from "@/api/classifier";
import { comfyExportArgs } from "@/api/comfyExport";
import { saveImage, writeTextFile } from "@/api/tauri";
import type { CivitaiImage } from "@/api/types";
import { useSettingsStore } from "@/stores/settings";
import { useDownloadStore } from "@/stores/downloads";
import { formatCount, cn } from "@/lib/utils";
import { notify } from "@/lib/toast";

interface DetailPanelProps {
  image: CivitaiImage | null;
  onClose: () => void;
  onDragStart: (image: CivitaiImage) => void;
}

export function DetailPanel({
  image,
  onClose,
  onDragStart,
}: DetailPanelProps) {
  const { apiToken, downloadDir, setDownloadDir } = useSettingsStore();
  const [busy, setBusy] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);

  useEffect(() => {
    setPreviewReady(false);
  }, [image?.id]);

  if (!image) return null;

  const current = image;
  const prompt = extractPrompt(current.meta);
  const negative = extractNegativePrompt(current.meta);
  const workflow = extractWorkflowJson(current.meta);
  const resources = extractUsedResources(current.meta);
  const checkpoints = resources.filter((r) => r.kind === "checkpoint");
  const loras = resources.filter((r) => r.kind === "lora");
  const vaes = resources.filter((r) => r.kind === "vae");
  const embeddings = resources.filter((r) => r.kind === "embedding");
  const otherResources = resources.filter((r) => r.kind === "other");
  const previewSrc = galleryImageUrl(current, 640);
  const hearts = formatCount(
    current.stats?.heartCount ?? current.stats?.likeCount,
  );
  const comments = formatCount(current.stats?.commentCount);

  async function copyText(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    notify.success(`${label} copied`);
  }

  async function ensureDownloadDir(): Promise<string | null> {
    let dir = downloadDir;
    if (!dir) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ directory: true, multiple: false });
      if (!picked || Array.isArray(picked)) return null;
      dir = picked;
      await setDownloadDir(dir);
    }
    return dir;
  }

  async function handleDownload() {
    setBusy(true);
    try {
      const dir = await ensureDownloadDir();
      if (!dir) {
        setBusy(false);
        return;
      }
      const path = await saveImage({
        ...comfyExportArgs(current, apiToken || undefined),
        destinationDir: dir,
      });
      notify.saved("Image saved", path);
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveWorkflow() {
    if (!workflow) return;
    try {
      const dir = await ensureDownloadDir();
      if (!dir) return;
      const sep = dir.includes("\\") ? "\\" : "/";
      const path = `${dir.replace(/[/\\]$/, "")}${sep}civitai-${current.id}-workflow.json`;
      await writeTextFile(path, workflow);
      notify.saved("Workflow saved", path);
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <aside className="glass-strong flex h-full w-[340px] shrink-0 flex-col border-y-0 border-r-0">
      <div className="flex items-start justify-between gap-2 border-b border-white/10 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg">
            @{current.username ?? "unknown"}
          </p>
          <div className="mt-1 flex items-center gap-2.5 text-[11px] text-muted">
            <span className="tabular-nums">#{current.id}</span>
            <span className="inline-flex items-center gap-1" title="Hearts">
              <Heart className="h-3 w-3" strokeWidth={2} />
              <span className="tabular-nums">{hearts}</span>
            </span>
            <span className="inline-flex items-center gap-1" title="Comments">
              <MessageCircle className="h-3 w-3" strokeWidth={2} />
              <span className="tabular-nums">{comments}</span>
            </span>
          </div>
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
          className="relative mb-3 flex h-56 w-full items-center justify-center overflow-hidden rounded border border-white/10 bg-black/40"
        >
          {!previewReady && <BlurPlaceholder hash={current.hash} />}
          <img
            key={current.id}
            src={previewSrc}
            alt=""
            onLoad={() => setPreviewReady(true)}
            onError={() => setPreviewReady(true)}
            className={cn(
              "relative max-h-56 w-full object-contain transition-opacity duration-200",
              previewReady ? "opacity-100" : "opacity-0",
            )}
          />
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

        {checkpoints.length > 0 && (
          <Section title="Models">
            <ResourceList items={checkpoints} />
          </Section>
        )}

        {loras.length > 0 && (
          <Section title="LoRAs">
            <ResourceList items={loras} />
          </Section>
        )}

        {vaes.length > 0 && (
          <Section title="VAEs">
            <ResourceList items={vaes} />
          </Section>
        )}

        {embeddings.length > 0 && (
          <Section title="Embeddings">
            <ResourceList items={embeddings} />
          </Section>
        )}

        {otherResources.length > 0 && (
          <Section title="Other">
            <ResourceList items={otherResources} />
          </Section>
        )}

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
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--color-fg)]/90">
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
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--color-fg)]/90">
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
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--color-muted)]">
              {workflow}
            </pre>
          </Section>
        )}

      </div>
    </aside>
  );
}

function formatWeight(weight: number) {
  const rounded = Math.round(weight * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function ResourceList({ items }: { items: UsedResource[] }) {
  const enqueueResource = useDownloadStore((s) => s.enqueueResource);
  const jobs = useDownloadStore((s) => s.jobs);

  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const active = jobs.find(
          (j) =>
            j.name === item.name &&
            j.modelVersionId === item.modelVersionId &&
            (j.status === "queued" ||
              j.status === "resolving" ||
              j.status === "downloading" ||
              j.status === "paused"),
        );
        return (
          <li
            key={`${item.kind}-${item.name}-${item.version ?? ""}-${item.modelVersionId ?? ""}`}
            className="text-xs"
          >
            <div className="flex h-7 items-center gap-1">
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                title={`${item.name} — click to copy`}
                onClick={() => {
                  void navigator.clipboard.writeText(item.name).then(() => {
                    notify.success("Name copied");
                  });
                }}
              >
                {item.name}
              </button>
              {typeof item.weight === "number" && (
                <span className="shrink-0 text-[10px] tabular-nums text-[var(--color-muted)]">
                  ×{formatWeight(item.weight)}
                </span>
              )}
              {item.modelId != null && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  title="Open on Civitai"
                  onClick={() => {
                    const url = item.modelVersionId
                      ? `https://civitai.com/models/${item.modelId}?modelVersionId=${item.modelVersionId}`
                      : `https://civitai.com/models/${item.modelId}`;
                    void openUrl(url);
                  }}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0"
                title={
                  active
                    ? `Download ${active.status}`
                    : "Download model file"
                }
                disabled={
                  !!active &&
                  (active.status === "downloading" ||
                    active.status === "resolving" ||
                    active.status === "queued")
                }
                onClick={(e) => {
                  void enqueueResource(item, {
                    x: e.clientX,
                    y: e.clientY,
                  });
                }}
              >
                <Download
                  className={cn(
                    "h-3.5 w-3.5",
                    active && "text-[var(--color-accent)]",
                  )}
                />
              </Button>
            </div>
            {item.version && (
              <p className="-mt-0.5 truncate text-[10px] text-[var(--color-muted)]">
                {item.version}
              </p>
            )}
          </li>
        );
      })}
    </ul>
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
