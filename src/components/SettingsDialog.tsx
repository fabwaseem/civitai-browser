import { open } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettingsStore } from "@/stores/settings";
import type { NsfwOption } from "@/api/types";
import { checkForAppUpdate } from "@/lib/updater";
import { clearImageCache } from "@/api/tauri";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({
  open: isOpen,
  onOpenChange,
}: SettingsDialogProps) {
  const {
    apiToken,
    downloadDir,
    defaultNsfw,
    setApiToken,
    setDownloadDir,
    setDefaultNsfw,
  } = useSettingsStore();
  const [tokenDraft, setTokenDraft] = useState(apiToken);
  const [version, setVersion] = useState("…");
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [cacheMsg, setCacheMsg] = useState<string | null>(null);
  const [clearingCache, setClearingCache] = useState(false);

  useEffect(() => {
    if (isOpen) setTokenDraft(apiToken);
  }, [apiToken, isOpen]);

  useEffect(() => {
    void getVersion().then(setVersion).catch(() => setVersion("0.1.0"));
  }, []);

  async function pickDownloadDir() {
    const picked = await open({ directory: true, multiple: false });
    if (picked && !Array.isArray(picked)) {
      await setDownloadDir(picked);
    }
  }

  async function handleClearCache() {
    setClearingCache(true);
    setCacheMsg(null);
    try {
      const removed = await clearImageCache();
      setCacheMsg(
        removed === 0
          ? "Cache already empty"
          : `Cleared ${removed} cached file${removed === 1 ? "" : "s"}`,
      );
    } catch (e) {
      setCacheMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setClearingCache(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Persist API token, downloads folder, and defaults. App v{version}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="token">Civitai API token (optional)</Label>
            <Input
              id="token"
              type="password"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              onBlur={() => void setApiToken(tokenDraft.trim())}
              placeholder="Bearer token"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Download folder</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={downloadDir || "Not set — pick on first download"}
              />
              <Button variant="secondary" onClick={() => void pickDownloadDir()}>
                Browse
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Default NSFW filter</Label>
            <Select
              value={defaultNsfw}
              onValueChange={(v) => void setDefaultNsfw(v as NsfwOption)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["None", "Soft", "Mature", "X"] as NsfwOption[]).map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3">
            <div>
              <p className="text-xs text-[var(--color-fg)]">Image cache</p>
              <p className="text-[11px] text-[var(--color-muted)]">
                Clears downloaded originals and drag previews
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              disabled={clearingCache}
              onClick={() => void handleClearCache()}
            >
              {clearingCache ? "Clearing…" : "Clear cache"}
            </Button>
          </div>
          {cacheMsg && (
            <p className="text-xs text-[var(--color-accent)]">{cacheMsg}</p>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-[var(--color-border)] pt-3">
            <p className="text-xs text-[var(--color-muted)]">
              Updates from GitHub Releases
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                setUpdateMsg("Checking…");
                const msg = await checkForAppUpdate(true);
                setUpdateMsg(msg);
              }}
            >
              Check for updates
            </Button>
          </div>
          {updateMsg && (
            <p className="text-xs text-[var(--color-accent)]">{updateMsg}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
