import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import {
  installUpdateAndRelaunch,
  probeForUpdate,
  type UpdateOffer,
} from "@/lib/updater";
import { Button } from "@/components/ui/button";
import { notify } from "@/lib/toast";

/** Launch check + mint banner when an update is ready. */
export function UpdateChecker() {
  const [offer, setOffer] = useState<UpdateOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

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
    try {
      notify.info("Installing update…");
      await installUpdateAndRelaunch(offer.update);
    } catch (e) {
      setBusy(false);
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      notify.error(msg);
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-10 z-80 flex justify-center px-3">
      <div className="pointer-events-auto glass-strong mt-2 flex w-full max-w-xl items-start gap-3 rounded-md px-3 py-2.5 shadow-2xl">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">
            Update {offer.version} ready
          </p>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted">
            {offer.notes}
          </p>
          {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void install()}
          >
            <Download className="h-3.5 w-3.5" />
            {busy ? "Installing…" : "Update now"}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            disabled={busy}
            title="Later"
            onClick={() => setDismissed(true)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
