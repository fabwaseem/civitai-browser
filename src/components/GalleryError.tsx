import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

function friendlyErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const msg = raw.trim();
  if (!msg) {
    return "Something went wrong while loading images. This can happen during a hot reload in development — try again.";
  }
  if (/error sending request|failed to fetch|network|timed out|eof/i.test(msg)) {
    return "Couldn’t reach Civitai. Check your connection and try again.";
  }
  if (/401|unauthorized|api.?key|token/i.test(msg)) {
    return "Civitai rejected the request. Check your API token in Settings.";
  }
  if (/429|rate.?limit/i.test(msg)) {
    return "Civitai rate-limited this request. Wait a moment and retry.";
  }
  return msg;
}

interface GalleryErrorProps {
  error: unknown;
  onRetry: () => void;
  busy?: boolean;
}

export function GalleryError({ error, onRetry, busy }: GalleryErrorProps) {
  return (
    <div className="grid h-full place-items-center px-6">
      <div
        className="w-full max-w-md rounded-lg px-5 py-6 text-center"
        style={{
          background: "rgba(15, 22, 20, 0.94)",
          border: "1px solid rgba(255, 123, 138, 0.28)",
          boxShadow: "0 14px 44px rgba(0, 0, 0, 0.45)",
        }}
      >
        <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-[var(--color-danger)]/15 text-[var(--color-danger)]">
          <AlertTriangle className="h-5 w-5" strokeWidth={2.25} />
        </div>
        <h2 className="text-sm font-medium text-fg">Couldn’t load images</h2>
        <p className="mt-2 text-xs leading-relaxed text-muted">
          {friendlyErrorMessage(error)}
        </p>
        <Button
          className="mt-4"
          size="sm"
          disabled={busy}
          onClick={onRetry}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
          Retry
        </Button>
      </div>
    </div>
  );
}
