import type { ReactNode } from "react";
import {
  LayoutGrid,
  Columns3,
  RefreshCw,
  RotateCcw,
  Settings,
  SlidersHorizontal,
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
import { useFilterStore } from "@/stores/filters";
import { useUiStore, type ViewMode } from "@/stores/ui";
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
  { value: "workflow", label: "Comfy graph" },
  { value: "meta", label: "Has meta" },
  { value: "all", label: "All" },
];

const VIEWS: { id: ViewMode; icon: typeof Columns3; label: string }[] = [
  { id: "masonry", icon: Columns3, label: "Masonry" },
  { id: "grid", icon: LayoutGrid, label: "Grid" },
];

interface FilterBarProps {
  onRefresh: () => void;
  onOpenSettings: () => void;
  isFetching: boolean;
  resultCount: number;
}

export function FilterBar({
  onRefresh,
  onOpenSettings,
  isFetching,
  resultCount,
}: FilterBarProps) {
  const filters = useFilterStore();
  const { viewMode, setViewMode, filtersOpen, toggleFiltersOpen } = useUiStore();

  return (
    <header className="glass sticky top-0 z-20 rounded-none border-x-0 border-t-0 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-1 flex min-w-0 items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
            <span className="text-sm font-bold">C</span>
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold tracking-tight">
              Civitai Browser
            </h1>
            <p className="truncate text-[10px] text-[var(--color-muted)]">
              {resultCount} shown{isFetching ? " · loading" : ""}
            </p>
          </div>
        </div>

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
                  ? "bg-[var(--color-accent)] text-[#041018]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-fg)]",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>

        <Button
          variant={filtersOpen ? "default" : "secondary"}
          size="sm"
          onClick={toggleFiltersOpen}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          More
        </Button>
        <Button variant="secondary" size="icon" onClick={onRefresh} title="Refresh">
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
        <Button
          variant="secondary"
          size="icon"
          onClick={() => filters.reset()}
          title="Reset filters"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <Button variant="secondary" size="icon" onClick={onOpenSettings}>
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </div>

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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="space-y-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
      <span>{label}</span>
      {children}
    </label>
  );
}
