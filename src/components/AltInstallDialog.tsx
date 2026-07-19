import { Check, Copy, Download, FolderOpen } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { openPath } from "@/api/tauri";
import { useDownloadStore } from "@/stores/downloads";
import { notify } from "@/lib/toast";

export function AltInstallDialog() {
  const prompt = useDownloadStore((s) => s.altInstallPrompt);
  const dismiss = useDownloadStore((s) => s.dismissAltInstall);
  const confirmDownload = useDownloadStore((s) => s.confirmDownloadAsWorkflow);

  const open = !!prompt;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
        <div className="border-b border-[var(--color-border)] bg-[var(--color-accent-soft)]/40 px-5 py-4">
          <DialogHeader className="gap-1">
            <DialogTitle className="text-base">Already on disk</DialogTitle>
            <DialogDescription className="text-[13px] leading-snug text-[var(--color-muted)]">
              Same model via hash — saved under a different filename than this
              workflow expects.
            </DialogDescription>
          </DialogHeader>
        </div>

        {prompt && (
          <div className="space-y-4 px-5 py-4">
            <NamePair
              label="Workflow asks for"
              name={prompt.workflowName}
              muted
            />
            <NamePair
              label="You already have"
              name={prompt.localFileName}
              hint={prompt.relative}
              accent
            />

            <div className="flex flex-col gap-2 pt-1">
              <Button
                className="h-9 justify-center gap-2"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(prompt.localFileName)
                    .then(() => {
                      notify.success("Filename copied — pick it in ComfyUI");
                      dismiss();
                    });
                }}
              >
                <Copy className="h-3.5 w-3.5" />
                Use this name in workflow
              </Button>
              <Button
                variant="secondary"
                className="h-9 justify-center gap-2"
                onClick={() => void confirmDownload()}
              >
                <Download className="h-3.5 w-3.5" />
                Download as workflow name
              </Button>
              {prompt.path && (
                <Button
                  variant="ghost"
                  className="h-8 justify-center gap-2 text-[var(--color-muted)]"
                  onClick={() => {
                    void openPath(prompt.path!).catch((e) =>
                      notify.error(e instanceof Error ? e.message : String(e)),
                    );
                  }}
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                  Show in folder
                </Button>
              )}
            </div>

            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-[var(--color-muted)]">
              <Check
                className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-accent)]"
                strokeWidth={2.5}
              />
              Prefer the existing file when you can — avoids a duplicate download.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NamePair({
  label,
  name,
  hint,
  muted,
  accent,
}: {
  label: string;
  name: string;
  hint?: string | null;
  muted?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        {label}
      </p>
      <p
        className={
          accent
            ? "truncate font-mono text-sm text-[var(--color-accent)]"
            : muted
              ? "truncate font-mono text-sm text-[var(--color-fg)]/70"
              : "truncate font-mono text-sm text-[var(--color-fg)]"
        }
        title={name}
      >
        {name}
      </p>
      {hint ? (
        <p className="mt-0.5 truncate text-[10px] text-[var(--color-muted)]" title={hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
