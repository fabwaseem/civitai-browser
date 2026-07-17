import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  children,
  tone = "default",
}: {
  className?: string;
  children: ReactNode;
  tone?: "default" | "workflow" | "meta";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide backdrop-blur-md",
        tone === "workflow" &&
          "bg-[var(--color-workflow)]/18 text-[var(--color-workflow)] ring-1 ring-[var(--color-workflow)]/30",
        tone === "meta" &&
          "bg-[var(--color-accent)]/18 text-[var(--color-accent)] ring-1 ring-[var(--color-accent)]/30",
        tone === "default" &&
          "bg-white/10 text-[var(--color-muted)] ring-1 ring-white/10",
        className,
      )}
    >
      {children}
    </span>
  );
}
