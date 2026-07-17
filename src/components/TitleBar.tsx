import { getCurrentWindow } from "@tauri-apps/api/window";
import { TitleDragRegion, WindowControls } from "@/components/WindowControls";
import { cn } from "@/lib/utils";
import logo from "@/assets/logo.svg";

interface TitleBarProps {
  sidebarOpen?: boolean;
  resultCount?: number;
  isFetching?: boolean;
}

/** Frameless chrome: brand + drag region + window controls over the sidebar. */
export function TitleBar({
  sidebarOpen,
  resultCount = 0,
  isFetching,
}: TitleBarProps) {
  return (
    <div className="glass flex h-10 shrink-0 items-stretch border-x-0 border-t-0">
      <div
        data-tauri-drag-region
        className="flex min-w-0 flex-1 items-center gap-2.5 px-3"
        onDoubleClick={() => {
          void getCurrentWindow().toggleMaximize();
        }}
      >
        <img
          src={logo}
          alt=""
          width={28}
          height={28}
          className="pointer-events-none h-7 w-7 shrink-0 rounded-md ring-1 ring-white/15"
          draggable={false}
        />
        <div className="min-w-0 pointer-events-none">
          <h1 className="truncate text-sm font-semibold tracking-tight leading-tight">
            Civitai Browser
          </h1>
          <p className="truncate text-[10px] leading-tight text-[var(--color-muted)]">
            {resultCount} shown{isFetching ? " · loading" : ""}
          </p>
        </div>
        <TitleDragRegion className="ml-2" />
      </div>

      <div
        className={cn(
          "flex shrink-0 items-stretch justify-end",
          sidebarOpen && "w-[340px] border-l border-white/10",
        )}
      >
        <WindowControls />
      </div>
    </div>
  );
}
