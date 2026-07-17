import { useEffect, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function WindowControls({ className }: { className?: string }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    void win.isMaximized().then(setMaximized);
    void win
      .onResized(() => {
        void win.isMaximized().then(setMaximized);
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, []);

  async function minimize() {
    await getCurrentWindow().minimize();
  }

  async function toggleMaximize() {
    await getCurrentWindow().toggleMaximize();
    setMaximized(await getCurrentWindow().isMaximized());
  }

  async function close() {
    await getCurrentWindow().close();
  }

  return (
    <div className={cn("flex h-9 shrink-0 items-stretch", className)}>
      <ControlButton title="Minimize" onClick={() => void minimize()}>
        <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
      </ControlButton>
      <ControlButton
        title={maximized ? "Restore" : "Maximize"}
        onClick={() => void toggleMaximize()}
      >
        {maximized ? (
          <span className="relative block h-3 w-3">
            <span className="absolute left-0 top-0.5 h-2 w-2 border border-current" />
            <span className="absolute left-0.5 top-0 h-2 w-2 border border-current bg-[var(--color-bg-panel)]" />
          </span>
        ) : (
          <Square className="h-3 w-3" strokeWidth={1.75} />
        )}
      </ControlButton>
      <ControlButton title="Close" danger onClick={() => void close()}>
        <X className="h-3.5 w-3.5" strokeWidth={1.75} />
      </ControlButton>
    </div>
  );
}

/** Draggable strip for the frameless window; keep interactive controls outside it. */
export function TitleDragRegion({ className }: { className?: string }) {
  return (
    <div
      data-tauri-drag-region
      className={cn("h-9 min-w-0 flex-1", className)}
      onDoubleClick={() => {
        void getCurrentWindow().toggleMaximize();
      }}
    />
  );
}

function ControlButton({
  title,
  onClick,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "grid w-11 place-items-center text-[var(--color-muted)] transition-colors",
        danger
          ? "hover:bg-[var(--color-danger)] hover:text-white"
          : "hover:bg-white/10 hover:text-[var(--color-fg)]",
      )}
    >
      {children}
    </button>
  );
}
