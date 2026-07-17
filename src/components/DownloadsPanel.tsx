import { useState, type ReactNode } from "react";
import {
  Check,
  CheckCircle2,
  Clock,
  FolderOpen,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { openPath } from "@/api/tauri";
import { useDownloadStore, type DownloadJob } from "@/stores/downloads";
import { useSettingsStore } from "@/stores/settings";
import { cn, formatBytes, formatSpeed } from "@/lib/utils";
import { notify } from "@/lib/toast";

interface DownloadsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DownloadsPanel({ open, onOpenChange }: DownloadsPanelProps) {
  const jobs = useDownloadStore((s) => s.jobs);
  const clearFinished = useDownloadStore((s) => s.clearFinished);
  const activeCount = jobs.filter(
    (j) =>
      j.status === "queued" ||
      j.status === "resolving" ||
      j.status === "downloading",
  ).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Downloads</DialogTitle>
          <DialogDescription>
            {activeCount > 0
              ? `${activeCount} active · resumable · concurrent queue`
              : "Queue models & LoRAs from the sidebar"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            disabled={!jobs.some((j) =>
              ["completed", "failed", "cancelled"].includes(j.status),
            )}
            onClick={() => void clearFinished()}
          >
            Clear finished
          </Button>
        </div>

        <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {jobs.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--color-muted)]">
              No downloads yet. Use the download icon next to a model or LoRA.
            </p>
          ) : (
            jobs.map((job) => <DownloadRow key={job.id} job={job} />)
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function statusLabel(status: DownloadJob["status"]): string | null {
  switch (status) {
    case "queued":
      return "Queued";
    case "resolving":
      return "Pending…";
    case "paused":
      return "Paused";
    case "cancelled":
      return "Cancelled";
    default:
      return null;
  }
}

function DownloadRow({ job }: { job: DownloadJob }) {
  const [confirming, setConfirming] = useState(false);
  const confirmBeforeDelete = useSettingsStore((s) => s.confirmBeforeDelete);
  const pauseJob = useDownloadStore((s) => s.pauseJob);
  const resumeJob = useDownloadStore((s) => s.resumeJob);
  const cancelJob = useDownloadStore((s) => s.cancelJob);
  const retryJob = useDownloadStore((s) => s.retryJob);
  const removeJob = useDownloadStore((s) => s.removeJob);

  const pct =
    job.total && job.total > 0
      ? Math.min(100, Math.round((job.downloaded / job.total) * 100))
      : null;

  const canAskConfirm =
    job.status === "queued" ||
    job.status === "resolving" ||
    job.status === "downloading" ||
    job.status === "paused";

  const label = statusLabel(job.status);

  function runDestructive() {
    if (
      job.status === "queued" ||
      job.status === "resolving" ||
      job.status === "downloading"
    ) {
      void cancelJob(job.id);
    } else {
      void removeJob(job.id);
    }
  }

  function onCancelOrRemove() {
    if (confirmBeforeDelete && canAskConfirm) {
      setConfirming(true);
      return;
    }
    runDestructive();
  }

  function confirmAction() {
    setConfirming(false);
    runDestructive();
  }

  return (
    <div className="glass-chip rounded-md p-2.5">
      <div className="flex items-start gap-2">
        <StatusIcon status={job.status} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-[var(--color-fg)]">
            {job.name}
          </p>
          <p className="truncate text-[10px] text-[var(--color-muted)]">
            {job.kind}
            {job.fileName ? ` · ${job.fileName}` : ""}
            {job.version ? ` · ${job.version}` : ""}
            {label ? ` · ${label}` : ""}
          </p>

          {(job.status === "downloading" ||
            job.status === "paused" ||
            (job.status === "resolving" && job.downloaded > 0)) && (
            <div className="mt-1.5">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    job.status === "paused"
                      ? "bg-[var(--color-muted)]"
                      : "bg-[var(--color-accent)]",
                  )}
                  style={{ width: pct != null ? `${pct}%` : "30%" }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-[var(--color-muted)]">
                <span>
                  {formatBytes(job.downloaded)}
                  {job.total != null ? ` / ${formatBytes(job.total)}` : ""}
                  {pct != null ? ` (${pct}%)` : ""}
                </span>
                <span>
                  {job.status === "paused"
                    ? "Paused"
                    : formatSpeed(job.speed)}
                </span>
              </div>
            </div>
          )}

          {job.error &&
            job.status !== "downloading" &&
            job.status !== "paused" && (
              <p className="mt-1 line-clamp-3 text-[10px] text-[var(--color-danger)]">
                {job.error}
              </p>
            )}

          {job.status === "completed" && job.destPath && (
            <p className="mt-1 truncate text-[10px] text-[var(--color-accent)]">
              {job.destPath}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {confirming && canAskConfirm ? (
            <>
              <IconBtn
                title="Confirm"
                className="text-[var(--color-danger)]"
                onClick={confirmAction}
              >
                <Check className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn title="Keep" onClick={() => setConfirming(false)}>
                <X className="h-3.5 w-3.5" />
              </IconBtn>
            </>
          ) : (
            <>
              {job.status === "downloading" && (
                <IconBtn title="Pause" onClick={() => void pauseJob(job.id)}>
                  <Pause className="h-3.5 w-3.5" />
                </IconBtn>
              )}
              {(job.status === "paused" || job.status === "cancelled") && (
                <IconBtn title="Resume" onClick={() => void resumeJob(job.id)}>
                  <Play className="h-3.5 w-3.5" />
                </IconBtn>
              )}
              {job.status === "failed" && (
                <IconBtn title="Retry" onClick={() => void retryJob(job.id)}>
                  <RotateCcw className="h-3.5 w-3.5" />
                </IconBtn>
              )}
              {job.status === "completed" && job.destPath && (
                <IconBtn
                  title="Show in folder"
                  onClick={() => {
                    void openPath(job.destPath!).catch((e) =>
                      notify.error(
                        e instanceof Error ? e.message : String(e),
                      ),
                    );
                  }}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </IconBtn>
              )}
              {(job.status === "queued" ||
                job.status === "resolving" ||
                job.status === "downloading") && (
                <IconBtn title="Cancel" onClick={onCancelOrRemove}>
                  <X className="h-3.5 w-3.5" />
                </IconBtn>
              )}
              {job.status === "paused" && (
                <IconBtn title="Remove" onClick={onCancelOrRemove}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconBtn>
              )}
              {(job.status === "completed" ||
                job.status === "failed" ||
                job.status === "cancelled") && (
                <IconBtn title="Remove" onClick={() => void removeJob(job.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconBtn>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: DownloadJob["status"] }) {
  if (status === "completed") {
    return (
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent)]" />
    );
  }
  if (status === "failed") {
    return (
      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-danger)]" />
    );
  }
  if (status === "downloading" || status === "resolving") {
    return (
      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[var(--color-accent)]" />
    );
  }
  if (status === "paused") {
    return (
      <Pause className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-muted)]" />
    );
  }
  if (status === "queued") {
    return (
      <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-muted)]" />
    );
  }
  return (
    <div className="mt-0.5 h-4 w-4 shrink-0 rounded-full border border-white/20" />
  );
}

function IconBtn({
  title,
  onClick,
  children,
  className,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Button
      size="icon"
      variant="ghost"
      title={title}
      className={className}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
