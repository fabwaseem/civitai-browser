import type { NsfwOption } from "@/api/types";

/** Rank for comparing Civitai NSFW levels (higher = more explicit). */
export function nsfwRank(level?: string | number | null): number {
  if (level == null || level === "") return 0;

  if (typeof level === "number") {
    // Civitai flag-style: None=1, Soft=2, Mature=4, X=8 (+ combinations)
    if (level >= 8) return 3;
    if (level >= 4) return 2;
    if (level >= 2) return 1;
    return 0;
  }

  const s = String(level).trim().toLowerCase();
  if (s === "x" || s === "xxx" || s === "8") return 3;
  if (s === "mature" || s === "4") return 2;
  if (s === "soft" || s === "2") return 1;
  if (s === "none" || s === "1" || s === "0") return 0;

  const n = Number(s);
  if (!Number.isNaN(n)) return nsfwRank(n);
  return 0;
}

export type BlurNsfwFrom = Exclude<NsfwOption, "None">;

export function shouldBlurNsfw(
  level: string | number | null | undefined,
  enabled: boolean,
  from: BlurNsfwFrom,
): boolean {
  if (!enabled) return false;
  return nsfwRank(level) >= nsfwRank(from);
}
