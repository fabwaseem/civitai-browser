#!/usr/bin/env node
/**
 * Generate latest.json for Tauri updater after a local `pnpm tauri build`.
 *
 * Usage:
 *   node scripts/generate-latest-json.mjs --repo fabwaseem/civitai-browser --notes "Bug fixes"
 *
 * Env:
 *   GITHUB_REPO   owner/name (optional if --repo set)
 *   RELEASE_NOTES notes text
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function arg(name, fallback = undefined) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

const conf = JSON.parse(
  fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"),
);
const version = conf.version;
const productName = conf.productName || "Civitai Browser";
const repo =
  arg("repo") ||
  process.env.GITHUB_REPO ||
  "fabwaseem/civitai-browser";
const notes = arg("notes") || process.env.RELEASE_NOTES || `Release ${version}`;

const bundleDir = path.join(root, "src-tauri", "target", "release", "bundle");
const nsisDir = path.join(bundleDir, "nsis");

function findArtifact() {
  if (!fs.existsSync(nsisDir)) return null;
  const files = fs.readdirSync(nsisDir);
  // Prefer updater zip if present, else setup exe
  const zip = files.find((f) => f.endsWith(".nsis.zip") || f.endsWith("-setup.exe.zip"));
  const exe = files.find((f) => f.endsWith("-setup.exe") || f.endsWith(".exe"));
  const name = zip || exe;
  if (!name) return null;
  const sigName = `${name}.sig`;
  const sigPath = path.join(nsisDir, sigName);
  if (!fs.existsSync(sigPath)) {
    console.warn(`Missing signature file: ${sigPath}`);
  }
  const signature = fs.existsSync(sigPath)
    ? fs.readFileSync(sigPath, "utf8").trim()
    : "";
  return { name, signature };
}

const artifact = findArtifact();
if (!artifact) {
  console.error(
    "No NSIS artifacts found. Run `pnpm tauri build` with signing keys first.",
  );
  process.exit(1);
}

const url = `https://github.com/${repo}/releases/download/v${version}/${artifact.name}`;
const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: artifact.signature,
      url,
    },
  },
};

const outPath = path.join(root, "latest.json");
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Wrote ${outPath}`);
console.log(`Product: ${productName}`);
console.log(`Upload to GitHub Release v${version}:`);
console.log(`  - ${path.join(nsisDir, artifact.name)}`);
console.log(`  - ${path.join(nsisDir, artifact.name)}.sig (if separate)`);
console.log(`  - latest.json`);
