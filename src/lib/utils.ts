import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCount(n?: number | null) {
  if (n == null) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatBytes(n?: number | null) {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 1024) return `${Math.round(n)} B`;
  if (abs < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (abs < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function formatSpeed(bytesPerSec?: number | null) {
  if (bytesPerSec == null || bytesPerSec <= 0) return "";
  return `${formatBytes(bytesPerSec)}/s`;
}

export function joinPath(dir: string, fileName: string) {
  const base = dir.replace(/[/\\]+$/, "");
  const sep = dir.includes("\\") ? "\\" : "/";
  return `${base}${sep}${fileName}`;
}

/** Basename only (last path segment). */
export function fileBasename(name: string) {
  const trimmed = name.trim();
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || trimmed;
}

export function sameBasename(a: string, b: string) {
  return fileBasename(a).toLowerCase() === fileBasename(b).toLowerCase();
}

