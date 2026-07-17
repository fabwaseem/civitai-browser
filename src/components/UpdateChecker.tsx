import { useEffect, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import {
  installUpdateAndRelaunch,
  probeForUpdate,
  type UpdateOffer,
  type UpdateProgress,
} from "@/lib/updater";
import { Button } from "@/components/ui/button";
import { formatBytes, formatSpeed, cn } from "@/lib/utils";
import { notify } from "@/lib/toast";

function formatPercent(percent: number | null): string | null {
  if (percent == null) return null;
  return Number.isInteger(percent)
    ? `${percent}%`
    : `${percent.toFixed(1)}%`;
}

/** Launch check + opaque toast-style banner when an update is ready. */
export function UpdateChecker() {
  const [offer, setOffer] = useState<UpdateOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const next = await probeForUpdate();
          if (next) setOffer(next);
        } catch {
          /* quiet on launch */
        }
      })();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  if (!offer || dismissed) return null;

  async function install() {
    if (!offer) return;
    setBusy(true);
    setError(null);
    setProgress({
      phase: "downloading",
      downloaded: 0,
      total: null,
      percent: null,
      speed: null,
    });
    try {
      await installUpdateAndRelaunch(offer.update, setProgress);
    } catch (e) {
      setBusy(false);
      setProgress(null);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      notify.error(msg);
    }
  }

  const percentLabel = formatPercent(progress?.percent ?? null);
  const phaseLabel =
    progress?.phase === "installing"
      ? "Installing…"
      : progress?.phase === "done"
        ? "Restarting…"
        : percentLabel
          ? `Downloading ${percentLabel}`
          : progress
            ? "Downloading…"
            : "Update now";

  const detailLine = (() => {
    if (!progress) return null;
    if (progress.phase === "installing" || progress.phase === "done") {
      return "Applying update…";
    }
    const parts: string[] = [];
    if (progress.total) {
      parts.push(
        `${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}`,
      );
    } else if (progress.downloaded > 0) {
      parts.push(formatBytes(progress.downloaded));
    } else {
      parts.push("Starting download…");
    }
    if (percentLabel) parts.push(percentLabel);
    const speed = formatSpeed(progress.speed);
    if (speed) parts.push(speed);
    return parts.join(" · ");
  })();

  return (
    <div className="pointer-events-none fixed inset-x-0 top-10 z-[200] flex justify-center px-3">
      <div
        className="pointer-events-auto mt-2 w-full max-w-xl rounded-lg px-3.5 py-3"
        style={{
          background: "rgba(15, 22, 20, 0.97)",
          border: "1px solid rgba(184, 255, 224, 0.22)",
          boxShadow: "0 14px 44px rgba(0, 0, 0, 0.65)",
        }}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">
              Update {offer.version} ready
            </p>
            <p className="mt-0.5 line-clamp-2 text-xs text-muted">
              {offer.notes}
            </p>
            {error && (
              <p className="mt-1.5 text-xs text-danger">{error}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button size="sm" disabled={busy} onClick={() => void install()}>
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {phaseLabel}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              disabled={busy}
              title="Later"
              onClick={() => setDismissed(true)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {progress && (
          <div className="mt-2.5 space-y-1.5">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className={cn(
                  "h-full rounded-full bg-[var(--color-accent)]",
                  progress.percent == null &&
                    progress.phase === "downloading" &&
                    "w-1/3 animate-pulse",
                )}
                style={
                  progress.percent != null
                    ? {
                        width: `${progress.percent}%`,
                        transition: "width 1s linear",
                      }
                    : progress.phase === "installing" ||
                        progress.phase === "done"
                      ? { width: "100%", transition: "width 0.3s ease-out" }
                      : undefined
                }
              />
            </div>
            {detailLine && (
              <p className="text-[10px] tabular-nums text-muted">{detailLine}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
