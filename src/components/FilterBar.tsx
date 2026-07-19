import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  LayoutGrid,
  Columns3,
  RefreshCw,
  RotateCcw,
  Settings,
  SlidersHorizontal,
  Download,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFilterStore, isFiltersDirty } from "@/stores/filters";
import { useSettingsStore } from "@/stores/settings";
import { useUiStore, type ViewMode } from "@/stores/ui";
import { useDownloadStore } from "@/stores/downloads";
import { IMAGE_CATEGORY_TAGS } from "@/lib/imageTags";
import type {
  NsfwOption,
  PeriodOption,
  SortOption,
  WorkflowMode,
} from "@/api/types";
import { cn } from "@/lib/utils";

const SORTS: SortOption[] = [
  "Newest",
  "Most Reactions",
  "Most Comments",
  "Most Collected",
];
const PERIODS: PeriodOption[] = ["Day", "Week", "Month", "Year", "AllTime"];
const NSFW: NsfwOption[] = ["None", "Soft", "Mature", "X"];
const MODES: { value: WorkflowMode; label: string }[] = [
  { value: "workflow", label: "Has workflow" },
  { value: "all", label: "All" },
];

const VIEWS: { id: ViewMode; icon: typeof Columns3; label: string }[] = [
  { id: "masonry", icon: Columns3, label: "Masonry" },
  { id: "grid", icon: LayoutGrid, label: "Grid" },
];

interface FilterBarProps {
  onRefresh: () => void;
  onOpenSettings: () => void;
  onOpenDownloads: () => void;
  isFetching: boolean;
}

export function FilterBar({
  onRefresh,
  onOpenSettings,
  onOpenDownloads,
  isFetching,
}: FilterBarProps) {
  const filters = useFilterStore();
  const defaultNsfw = useSettingsStore((s) => s.defaultNsfw);
  const filtersDirty = isFiltersDirty(filters, defaultNsfw);
  const { viewMode, setViewMode, filtersOpen, toggleFiltersOpen } = useUiStore();
  const activeDownloads = useDownloadStore(
    (s) =>
      s.jobs.filter(
        (j) =>
          j.status === "queued" ||
          j.status === "resolving" ||
          j.status === "downloading" ||
          j.status === "paused",
      ).length,
  );
  const badgePulse = useDownloadStore((s) => s.badgePulse);

  return (
    <header className="glass sticky top-0 z-20 rounded-none border-x-0 border-t-0 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <CompactSelect
          value={filters.workflowMode}
          onChange={(v) => filters.setWorkflowMode(v as WorkflowMode)}
          width="w-[118px]"
        >
          {MODES.map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
        </CompactSelect>

        <CompactSelect
          value={filters.sort}
          onChange={(v) => filters.setSort(v as SortOption)}
          width="w-[140px]"
        >
          {SORTS.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </CompactSelect>

        <CompactSelect
          value={filters.period}
          onChange={(v) => filters.setPeriod(v as PeriodOption)}
          width="w-[100px]"
        >
          {PERIODS.map((p) => (
            <SelectItem key={p} value={p}>
              {p}
            </SelectItem>
          ))}
        </CompactSelect>

        <CompactSelect
          value={filters.nsfw}
          onChange={(v) => filters.setNsfw(v as NsfwOption)}
          width="w-[92px]"
        >
          {NSFW.map((n) => (
            <SelectItem key={n} value={n}>
              {n}
            </SelectItem>
          ))}
        </CompactSelect>

        <Button
          variant={filtersOpen ? "default" : "secondary"}
          size="sm"
          onClick={toggleFiltersOpen}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          More
        </Button>
        {filtersDirty && (
          <Button
            variant="secondary"
            size="icon"
            onClick={() => filters.reset()}
            title="Reset filters"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button variant="secondary" size="icon" onClick={onRefresh} title="Refresh">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>

        <div className="glass-chip ml-auto flex items-center rounded-md p-0.5">
          {VIEWS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              title={label}
              onClick={() => setViewMode(id)}
              className={cn(
                "grid h-8 w-8 place-items-center rounded transition",
                viewMode === id
                  ? "bg-[var(--color-accent)] text-[var(--color-accent-ink)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-fg)]",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>

        <Button
          id="app-downloads-btn"
          variant="secondary"
          size="icon"
          onClick={onOpenDownloads}
          title="Downloads"
          className="relative"
        >
          <Download className="h-3.5 w-3.5" />
          {activeDownloads > 0 && (
            <span
              key={badgePulse}
              className="download-badge-pop absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--color-accent)] px-0.5 text-[9px] font-semibold text-[var(--color-accent-ink)]"
            >
              {activeDownloads > 9 ? "9+" : activeDownloads}
            </span>
          )}
        </Button>
        <Button variant="secondary" size="icon" onClick={onOpenSettings}>
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </div>

      <TagScroller
        selected={filters.tagIds}
        onToggle={(id) => filters.toggleTagId(id)}
      />

      {filtersOpen && (
        <div className="mt-2 grid grid-cols-2 gap-2 border-t border-white/10 pt-2 md:grid-cols-4">
          <Field label="Username">
            <Input
              value={filters.username}
              onChange={(e) => filters.setUsername(e.target.value)}
              placeholder="creator"
              className="h-8"
            />
          </Field>
          <Field label="Model ID">
            <Input
              value={filters.modelId}
              onChange={(e) => filters.setModelId(e.target.value)}
              placeholder="12345"
              inputMode="numeric"
              className="h-8"
            />
          </Field>
          <Field label="Version ID">
            <Input
              value={filters.modelVersionId}
              onChange={(e) => filters.setModelVersionId(e.target.value)}
              placeholder="67890"
              inputMode="numeric"
              className="h-8"
            />
          </Field>
          <Field label="Base models">
            <Input
              value={filters.baseModels}
              onChange={(e) => filters.setBaseModels(e.target.value)}
              placeholder="SDXL, Flux.1 D"
              className="h-8"
            />
          </Field>
        </div>
      )}
    </header>
  );
}

function CompactSelect({
  value,
  onChange,
  width,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  width: string;
  children: ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn("h-8 glass-chip border-white/10 text-xs", width)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>{children}</SelectContent>
    </Select>
  );
}

function TagScroller({
  selected,
  onToggle,
}: {
  selected: number[];
  onToggle: (id: number) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startScroll: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateEdges = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(max > 2 && el.scrollLeft < max - 2);
  };

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateEdges();
    const onScroll = () => updateEdges();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => updateEdges());
    ro.observe(el);
    const t = window.setTimeout(updateEdges, 50);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      window.clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    const onMove = (e: globalThis.PointerEvent) => {
      const drag = dragRef.current;
      const el = scrollerRef.current;
      if (!drag || !el || drag.pointerId !== e.pointerId) return;
      const dx = e.clientX - drag.startX;
      if (!drag.moved && Math.abs(dx) > 6) {
        drag.moved = true;
        el.classList.add("cursor-grabbing");
      }
      if (drag.moved) {
        el.scrollLeft = drag.startScroll - dx;
        e.preventDefault();
      }
    };
    const onUp = (e: globalThis.PointerEvent) => {
      const drag = dragRef.current;
      const el = scrollerRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (drag.moved) {
        suppressClickRef.current = true;
        // Clear after the click event that follows pointerup
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }
      el?.classList.remove("cursor-grabbing");
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const scrollByDir = (dir: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({
      left: dir * Math.max(180, el.clientWidth * 0.55),
      behavior: "smooth",
    });
  };

  return (
    <div className="relative -mx-3 mt-2 h-7">
      <div
        ref={scrollerRef}
        className={cn(
          "flex h-full items-center gap-1.5 overflow-x-auto px-3",
          "cursor-grab select-none",
          "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        )}
        role="listbox"
        aria-label="Image tags"
        aria-multiselectable
        onScroll={updateEdges}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const el = scrollerRef.current;
          if (!el) return;
          // Don't capture — let chips receive clicks; drag starts after threshold
          dragRef.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startScroll: el.scrollLeft,
            moved: false,
          };
        }}
        onWheel={(e) => {
          const el = scrollerRef.current;
          if (!el) return;
          const delta =
            Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
          if (delta === 0) return;
          el.scrollLeft += delta;
          e.preventDefault();
        }}
      >
        {IMAGE_CATEGORY_TAGS.map((tag) => {
          const active = selected.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => {
                if (suppressClickRef.current || dragRef.current?.moved) return;
                onToggle(tag.id);
              }}
              className={cn(
                "h-7 shrink-0 rounded-md px-2.5 text-[11px] font-medium uppercase tracking-wide transition",
                active
                  ? "bg-[var(--color-accent)] text-[var(--color-accent-ink)]"
                  : "bg-white/[0.08] text-[var(--color-fg)]/85 hover:bg-white/[0.14]",
              )}
            >
              {tag.name}
            </button>
          );
        })}
      </div>

      {canLeft && (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-[#0a1210] from-40% to-transparent"
          aria-hidden
        >
          <button
            type="button"
            aria-label="Scroll tags left"
            className="pointer-events-auto absolute top-1/2 left-1 z-20 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-[var(--color-fg)] shadow-md backdrop-blur-sm transition hover:bg-black/75"
            onClick={() => scrollByDir(-1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {canRight && (
        <div
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-[#0a1210] from-40% to-transparent"
          aria-hidden
        >
          <button
            type="button"
            aria-label="Scroll tags right"
            className="pointer-events-auto absolute top-1/2 right-1 z-20 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-black/55 text-[var(--color-fg)] shadow-md backdrop-blur-sm transition hover:bg-black/75"
            onClick={() => scrollByDir(1)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
      <span>{label}</span>
      {children}
    </label>
  );
}
