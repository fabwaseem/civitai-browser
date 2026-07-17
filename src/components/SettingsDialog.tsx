import { open } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore } from "@/stores/ui";
import type { NsfwOption } from "@/api/types";
import { checkForAppUpdate } from "@/lib/updater";
import { clearImageCache, inspectComfyModelsDir } from "@/api/tauri";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/toast";
import logo from "@/assets/logo.svg";

export function SettingsDialog() {
  const isOpen = useUiStore((s) => s.settingsOpen);
  const focus = useUiStore((s) => s.settingsFocus);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

  const {
    apiToken,
    downloadDir,
    comfyModelsDir,
    maxConcurrentDownloads,
    confirmBeforeDelete,
    defaultNsfw,
    setApiToken,
    setDownloadDir,
    setComfyModelsDir,
    setMaxConcurrentDownloads,
    setConfirmBeforeDelete,
    setDefaultNsfw,
  } = useSettingsStore();

  const [tokenDraft, setTokenDraft] = useState(apiToken);
  const [version, setVersion] = useState("…");
  const [clearingCache, setClearingCache] = useState(false);
  const [modelsHint, setModelsHint] = useState<string | null>(null);
  const modelsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) setTokenDraft(apiToken);
  }, [apiToken, isOpen]);

  useEffect(() => {
    void getVersion().then(setVersion).catch(() => setVersion("0.1.0"));
  }, []);

  useEffect(() => {
    if (!isOpen || focus !== "models") return;
    const t = window.setTimeout(() => {
      modelsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => window.clearTimeout(t);
  }, [isOpen, focus]);

  useEffect(() => {
    if (!isOpen || !comfyModelsDir) {
      setModelsHint(null);
      return;
    }
    void inspectComfyModelsDir(comfyModelsDir)
      .then((info) => {
        setModelsHint(info.valid ? null : info.reason);
      })
      .catch((e) => {
        setModelsHint(e instanceof Error ? e.message : String(e));
      });
  }, [comfyModelsDir, isOpen]);

  async function pickImageDir() {
    const picked = await open({
      directory: true,
      multiple: false,
      title: "Download folder (images & workflows)",
    });
    if (picked && !Array.isArray(picked)) {
      await setDownloadDir(picked);
      notify.success("Download folder saved");
    }
  }

  async function pickComfyModelsDir() {
    const picked = await open({
      directory: true,
      multiple: false,
      title: "ComfyUI models folder",
    });
    if (!picked || Array.isArray(picked)) return;

    try {
      const info = await inspectComfyModelsDir(picked);
      setModelsHint(info.valid ? null : info.reason);
      if (!info.valid) {
        const proceed = window.confirm(
          `${info.reason}\n\nUse this folder anyway?`,
        );
        if (!proceed) return;
      }
      await setComfyModelsDir(picked);
      setModelsHint(null);
      notify.success("Models folder saved");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setModelsHint(msg);
      notify.error(msg);
    }
  }

  async function handleClearCache() {
    setClearingCache(true);
    try {
      const removed = await clearImageCache();
      notify.success(
        removed === 0
          ? "Cache already empty"
          : `Cleared ${removed} cached file${removed === 1 ? "" : "s"}`,
      );
    } catch (e) {
      notify.error(e instanceof Error ? e.message : String(e));
    } finally {
      setClearingCache(false);
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <img
              src={logo}
              alt=""
              width={28}
              height={28}
              className="h-7 w-7 rounded-md ring-1 ring-white/15"
            />
            <span className="flex flex-col gap-0.5">
              <span>Settings</span>
              <span className="text-[11px] font-normal text-[var(--color-muted)]">
                v{version}
              </span>
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <Section title="Account">
            <Field label="Civitai API token">
              <Input
                id="token"
                type="password"
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
                onBlur={() => {
                  const next = tokenDraft.trim();
                  if (next === apiToken) return;
                  void setApiToken(next).then(() =>
                    notify.success(
                      next ? "API token saved" : "API token cleared",
                    ),
                  );
                }}
                placeholder="Optional"
              />
            </Field>
          </Section>

          <Section title="Folders">
            <div
              ref={modelsRef}
              className={cn(
                "space-y-3 rounded-md p-0",
                focus === "models" &&
                  "ring-1 ring-[var(--color-accent)]/50 ring-offset-2 ring-offset-[var(--color-bg-panel)]",
              )}
            >
              <Field label="ComfyUI models">
                <DirRow
                  value={comfyModelsDir}
                  placeholder="Required for model downloads"
                  onBrowse={() => void pickComfyModelsDir()}
                />
                {modelsHint && (
                  <p className="text-[11px] text-[var(--color-danger)]">
                    {modelsHint}
                  </p>
                )}
              </Field>
            </div>
            <Field label="Images & workflows">
              <DirRow
                value={downloadDir}
                placeholder="Used for image and workflow saves"
                onBrowse={() => void pickImageDir()}
              />
            </Field>
          </Section>

          <Section title="Downloads">
            <Row
              label="Max concurrent"
              control={
                <Select
                  value={String(maxConcurrentDownloads)}
                  onValueChange={(v) =>
                    void setMaxConcurrentDownloads(Number(v))
                  }
                >
                  <SelectTrigger className="w-[110px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 8].map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              }
            />
            <Row
              label="Confirm before delete"
              control={
                <Switch
                  checked={confirmBeforeDelete}
                  onCheckedChange={(v) => void setConfirmBeforeDelete(v)}
                />
              }
            />
          </Section>

          <Section title="Gallery">
            <Row
              label="Default NSFW"
              control={
                <Select
                  value={defaultNsfw}
                  onValueChange={(v) => void setDefaultNsfw(v as NsfwOption)}
                >
                  <SelectTrigger className="w-[110px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["None", "Soft", "Mature", "X"] as NsfwOption[]).map(
                      (n) => (
                        <SelectItem key={n} value={n}>
                          {n}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              }
            />
          </Section>

          <Section title="App">
            <Row
              label="Image cache"
              control={
                <Button
                  variant="danger"
                  size="sm"
                  disabled={clearingCache}
                  onClick={() => void handleClearCache()}
                >
                  {clearingCache ? "…" : "Clear"}
                </Button>
              }
            />
            <Row
              label="Updates"
              control={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    const msg = await checkForAppUpdate(true);
                    if (/latest/i.test(msg)) notify.success(msg);
                    else if (/failed|error/i.test(msg)) notify.error(msg);
                    else if (msg) notify.info(msg);
                  }}
                >
                  Check
                </Button>
              }
            />
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-[var(--color-fg)]">{label}</Label>
      {children}
    </div>
  );
}

function Row({
  label,
  control,
}: {
  label: string;
  control: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-[var(--color-fg)]">{label}</span>
      {control}
    </div>
  );
}

function DirRow({
  value,
  placeholder,
  onBrowse,
}: {
  value: string;
  placeholder: string;
  onBrowse: () => void;
}) {
  return (
    <div className="flex gap-2">
      <Input
        readOnly
        value={value || placeholder}
        className={cn("text-xs", !value && "text-[var(--color-muted)]")}
      />
      <Button variant="secondary" onClick={onBrowse}>
        Browse
      </Button>
    </div>
  );
}
