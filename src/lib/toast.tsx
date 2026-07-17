import toast, { Toaster, type ToastOptions } from "react-hot-toast";
import { Check, FolderOpen, Info } from "lucide-react";
import type { CSSProperties } from "react";
import { openPath } from "@/api/tauri";

const baseStyle: CSSProperties = {
  background: "rgba(15, 22, 20, 0.94)",
  color: "var(--color-fg)",
  border: "1px solid rgba(184, 255, 224, 0.18)",
  borderRadius: "8px",
  backdropFilter: "blur(18px)",
  boxShadow: "0 14px 44px rgba(0, 0, 0, 0.5)",
  fontSize: "13px",
  padding: "12px 14px",
  maxWidth: "420px",
};

const base: ToastOptions = {
  duration: 3400,
  position: "bottom-center",
  style: baseStyle,
};

export function AppToaster() {
  return (
    <Toaster
      position="bottom-center"
      gutter={10}
      containerStyle={{ bottom: 20, zIndex: 300 }}
      toastOptions={{
        className: "app-toast",
        style: baseStyle,
        success: {
          duration: 2800,
          iconTheme: {
            primary: "#5ef0b0",
            secondary: "#071410",
          },
        },
        error: {
          duration: 4200,
          iconTheme: {
            primary: "#ff7b8a",
            secondary: "#1a1012",
          },
        },
      }}
    />
  );
}

export const notify = {
  success: (message: string, opts?: ToastOptions) =>
    toast.success(message, { ...base, ...opts }),
  error: (message: string, opts?: ToastOptions) =>
    toast.error(message, { ...base, ...opts }),
  info: (message: string, opts?: ToastOptions) =>
    toast(
      (t) => (
        <div className="flex items-start gap-2.5 pr-1">
          <Info
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent)]"
            strokeWidth={2.25}
          />
          <span className="leading-snug">{message}</span>
          <button
            type="button"
            className="ml-1 shrink-0 text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            onClick={() => toast.dismiss(t.id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ),
      { ...base, ...opts },
    ),
  saved: (message: string, path: string, opts?: ToastOptions) =>
    toast(
      (t) => (
        <div className="flex items-center gap-2.5">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#5ef0b0]">
            <Check className="h-3 w-3 text-[#071410]" strokeWidth={3} />
          </span>
          <span className="min-w-0 flex-1 leading-snug">{message}</span>
          <button
            type="button"
            className="shrink-0 rounded-md border border-white/12 bg-white/5 px-2 py-1 text-[11px] font-medium text-[var(--color-fg)] transition hover:bg-white/12"
            onClick={() => {
              void openPath(path).catch((e) =>
                notify.error(e instanceof Error ? e.message : String(e)),
              );
              toast.dismiss(t.id);
            }}
          >
            Open folder
          </button>
        </div>
      ),
      { ...base, duration: 5000, ...opts },
    ),
  modelsFolderRequired: () =>
    toast(
      (t) => (
        <div className="flex items-start gap-2.5 pr-1">
          <FolderOpen
            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent)]"
            strokeWidth={2.25}
          />
          <div className="min-w-0 leading-snug">
            <p className="font-medium text-[var(--color-fg)]">
              Models folder needed
            </p>
            <p className="mt-0.5 text-[12px] text-[var(--color-muted)]">
              Set your ComfyUI models folder in Settings to download.
            </p>
          </div>
          <button
            type="button"
            className="ml-1 shrink-0 text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            onClick={() => toast.dismiss(t.id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ),
      { ...base, id: "models-folder-required", duration: 4500 },
    ),
};
