#!/usr/bin/env node
/**
 * One-shot release for Civitai Browser
 *
 * What it does:
 *  1. Bumps version (optional) across package.json / tauri.conf.json / Cargo.toml
 *  2. Builds signed Tauri NSIS + updater artifacts
 *  3. Writes latest.json for the updater endpoint
 *  4. Commits version bump, tags, pushes to GitHub
 *  5. Creates a GitHub Release and uploads installer + .sig + latest.json
 *
 * Prerequisites (one-time):
 *  - gh auth login
 *  - Signing key at %USERPROFILE%\.tauri\civitai-browser.key
 *    (or set TAURI_SIGNING_PRIVATE_KEY / TAURI_SIGNING_PRIVATE_KEY_PATH)
 *  - Public key already in src-tauri/tauri.conf.json → plugins.updater.pubkey
 *
 * Usage:
 *   pnpm release
 *   pnpm release -- --bump patch
 *   pnpm release -- --bump minor --notes "New masonry theme"
 *   pnpm release -- --version 0.2.0
 *   pnpm release -- --skip-build          # reuse existing bundle
 *   pnpm release -- --skip-git            # don't commit/tag/push
 *   pnpm release -- --dry-run
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const REPO = process.env.GITHUB_REPO || "fabwaseem/civitai-browser";
const DEFAULT_KEY = path.join(os.homedir(), ".tauri", "civitai-browser.key");

function arg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith("--")) {
    return process.argv[idx + 1];
  }
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function log(msg) {
  console.log(`\n▶ ${msg}`);
}

function fail(msg, code = 1) {
  console.error(`\n✖ ${msg}`);
  process.exit(code);
}

function quoteWin(arg) {
  if (arg === "") return '""';
  if (!/[\s"&<>|^%]/.test(arg)) return arg;
  return `"${String(arg).replace(/"/g, '""')}"`;
}

/** Spawn without breaking multi-word args like -m "Initial release" on Windows. */
function spawnOk(cmd, args, opts = {}) {
  if (opts.env) Object.assign(process.env, opts.env);
  const stdio = opts.stdio ?? "inherit";
  const encoding = opts.encoding;
  const isCmdShim =
    process.platform === "win32" && ["pnpm", "npm", "npx"].includes(cmd);

  if (isCmdShim) {
    // .cmd shims need cmd.exe; quote args so spaces survive
    const line = [cmd, ...args.map(quoteWin)].join(" ");
    return spawnSync(line, {
      cwd: root,
      stdio,
      encoding,
      shell: true,
      env: process.env,
    });
  }

  return spawnSync(cmd, args, {
    cwd: root,
    stdio,
    encoding,
    shell: false,
    env: process.env,
  });
}

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const res = spawnOk(cmd, args, opts);
  if (res.status !== 0) {
    fail(`Command failed (${res.status}): ${cmd} ${args.join(" ")}`);
  }
}

function runCapture(cmd, args) {
  const res = spawnOk(cmd, args, { stdio: "pipe", encoding: "utf8" });
  if (res.status !== 0) {
    fail(
      `Command failed (${res.status}): ${cmd} ${args.join(" ")}\n${res.stderr || res.stdout}`,
    );
  }
  return (res.stdout || "").trim();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

function bumpSemver(version, kind) {
  const m = String(version).match(/^(\d+)\.(\d+)\.(\d+)(?:-.*)?$/);
  if (!m) fail(`Invalid semver: ${version}`);
  let [, major, minor, patch] = m.map(Number);
  if (kind === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (kind === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }
  return `${major}.${minor}.${patch}`;
}

function setVersions(next) {
  const pkgPath = path.join(root, "package.json");
  const confPath = path.join(root, "src-tauri", "tauri.conf.json");
  const cargoPath = path.join(root, "src-tauri", "Cargo.toml");

  const pkg = readJson(pkgPath);
  pkg.version = next;
  writeJson(pkgPath, pkg);

  const conf = readJson(confPath);
  conf.version = next;
  writeJson(confPath, conf);

  let cargo = fs.readFileSync(cargoPath, "utf8");
  cargo = cargo.replace(/^version\s*=\s*"[^"]+"/m, `version = "${next}"`);
  fs.writeFileSync(cargoPath, cargo);

  console.log(`Version → ${next}`);
}

function ensureGh() {
  const res = spawnOk("gh", ["--version"], { stdio: "pipe", encoding: "utf8" });
  if (res.status === 0) {
    console.log((res.stdout || "").split("\n")[0]);
    return;
  }
  fail(
    [
      "GitHub CLI (gh) is required for releases.",
      "Install:",
      "  winget install --id GitHub.cli",
      "Then:",
      "  gh auth login",
      "Or open a new terminal after install so PATH updates.",
    ].join("\n"),
  );
}

function ensureSigningEnv() {
  // Tauri build reads TAURI_SIGNING_PRIVATE_KEY (file path OR key contents).
  // PATH-only is not enough for `tauri build` updater artifacts.
  const existing =
    process.env.TAURI_SIGNING_PRIVATE_KEY ||
    process.env.TAURI_SIGNING_PRIVATE_KEY_PATH;
  const keyPath = existing && fs.existsSync(existing) ? existing : DEFAULT_KEY;

  if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
    if (fs.existsSync(keyPath)) {
      process.env.TAURI_SIGNING_PRIVATE_KEY = keyPath;
      process.env.TAURI_SIGNING_PRIVATE_KEY_PATH = keyPath;
      console.log(`Using signing key: ${keyPath}`);
    } else {
      fail(
        [
          "Missing Tauri updater signing key.",
          `Expected: ${DEFAULT_KEY}`,
          "Or set TAURI_SIGNING_PRIVATE_KEY to the key path/contents",
          "Generate once:",
          "  pnpm tauri signer generate -w %USERPROFILE%\\.tauri\\civitai-browser.key",
        ].join("\n"),
      );
    }
  } else {
    console.log("Using TAURI_SIGNING_PRIVATE_KEY from environment");
  }

  // Encrypted keys need this set (empty string if generated with no password)
  if (process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD === undefined) {
    process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "";
  }
}

/**
 * Stable updater asset name — no spaces (GitHub turns them into dots and
 * breaks URLs that still contain spaces).
 */
function updaterAssetBase(version) {
  return `civitai-browser-${version}-x64-setup`;
}

/**
 * Only artifacts for this release version (avoids uploading leftover
 * Civitai Browser_0.1.0_… next to 2.0.0 after a bump).
 */
function findNsisArtifacts(version) {
  const nsisDir = path.join(root, "src-tauri", "target", "release", "bundle", "nsis");
  if (!fs.existsSync(nsisDir)) return { nsisDir, files: [] };
  const token = `_${version}_`;
  const names = fs.readdirSync(nsisDir).filter((f) => f.includes(token));
  const zips = names.filter((f) => f.endsWith(".nsis.zip"));
  const exes = names.filter(
    (f) =>
      (f.endsWith("-setup.exe") || (f.endsWith(".exe") && !f.endsWith(".sig"))) &&
      !f.startsWith("civitai-browser-"), // ignore our renamed copies
  );
  const picked = [...zips, ...exes];
  const files = [];
  const base = updaterAssetBase(version);
  for (const name of picked) {
    const full = path.join(nsisDir, name);
    const sig = `${full}.sig`;
    const ext = name.endsWith(".nsis.zip") ? ".nsis.zip" : path.extname(name);
    const githubName = `${base}${ext === ".exe" ? ".exe" : ext}`;
    files.push({
      name,
      githubName,
      full,
      sig: fs.existsSync(sig) ? sig : null,
    });
  }
  return { nsisDir, files };
}

function writeLatestJson(version, notes, artifact) {
  const sigPath = artifact.sig;
  if (!sigPath) {
    fail(`Missing signature for ${artifact.name}. Build with signing key enabled.`);
  }
  const signature = fs.readFileSync(sigPath, "utf8").trim();
  const asset = artifact.githubName;
  const url = `https://github.com/${REPO}/releases/download/v${version}/${asset}`;
  const manifest = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
      "windows-x86_64": {
        signature,
        url,
      },
    },
  };
  const outPath = path.join(root, "latest.json");
  writeJson(outPath, manifest);
  console.log(`Wrote ${outPath}`);
  console.log(`  updater url → ${url}`);
  return outPath;
}

function main() {
  const dryRun = hasFlag("dry-run");
  const skipBuild = hasFlag("skip-build");
  const skipGit = hasFlag("skip-git");
  const bump = arg("bump"); // patch | minor | major
  const explicitVersion = arg("version");
  const notes =
    arg("notes") ||
    process.env.RELEASE_NOTES ||
    null;

  log("Reading current version");
  const conf = readJson(path.join(root, "src-tauri", "tauri.conf.json"));
  let version = conf.version;
  if (explicitVersion) {
    version = explicitVersion;
    if (!dryRun) setVersions(version);
    else console.log(`[dry-run] would set version ${version}`);
  } else if (bump) {
    if (!["patch", "minor", "major"].includes(bump)) {
      fail(`--bump must be patch|minor|major (got ${bump})`);
    }
    version = bumpSemver(version, bump);
    if (!dryRun) setVersions(version);
    else console.log(`[dry-run] would bump to ${version}`);
  } else {
    console.log(`Using existing version ${version}`);
  }

  const releaseNotes = notes || `Civitai Browser v${version}`;
  const tag = `v${version}`;

  if (!skipBuild) {
    log("Checking signing key");
    ensureSigningEnv();

    log("Building signed release (this can take a while)");
    if (dryRun) {
      console.log("[dry-run] pnpm tauri build");
    } else {
      run("pnpm", ["tauri", "build"], {
        env: {
          TAURI_SIGNING_PRIVATE_KEY:
            process.env.TAURI_SIGNING_PRIVATE_KEY || DEFAULT_KEY,
          TAURI_SIGNING_PRIVATE_KEY_PATH:
            process.env.TAURI_SIGNING_PRIVATE_KEY_PATH || DEFAULT_KEY,
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD:
            process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "",
        },
      });
    }
  } else {
    log("Skipping build (--skip-build)");
  }

  log("Locating NSIS / updater artifacts");
  const { nsisDir, files } = findNsisArtifacts(version);
  if (!files.length) {
    fail(
      [
        `No NSIS artifacts for v${version} in ${nsisDir}.`,
        "Run a full build first (without --skip-build), or clean stale bundles.",
      ].join("\n"),
    );
  }
  // Prefer zip (updater) for latest.json; still upload exe too
  const updaterArtifact =
    files.find((f) => f.name.endsWith(".nsis.zip")) || files[0];
  console.log(
    "Artifacts (this version only):\n" +
      files
        .map(
          (f) =>
            `  - ${f.name} → ${f.githubName}${f.sig ? " (+ .sig)" : " (NO .sig)"}`,
        )
        .join("\n"),
  );

  log("Writing latest.json");
  let latestPath;
  if (dryRun) {
    console.log(`[dry-run] latest.json for ${updaterArtifact.name}`);
    latestPath = path.join(root, "latest.json");
  } else {
    latestPath = writeLatestJson(version, releaseNotes, updaterArtifact);
  }

  if (!skipGit) {
    log("Git commit + tag + push");
    if (dryRun) {
      console.log(`[dry-run] commit version ${version}, tag ${tag}, push`);
    } else {
      // Only stage version files (+ latest.json is release asset, not usually committed)
      run("git", ["add", "package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml"]);
      const staged = runCapture("git", ["diff", "--cached", "--name-only"]);
      if (staged) {
        run("git", ["commit", "-m", `chore: release ${tag}`]);
      } else {
        console.log("No version file changes to commit");
      }
      // Recreate tag if exists locally
      spawnOk("git", ["tag", "-d", tag], { stdio: "pipe" });
      run("git", ["tag", "-a", tag, "-m", releaseNotes]);
      run("git", ["push", "origin", "HEAD"]);
      run("git", ["push", "origin", tag, "--force"]);
    }
  } else {
    log("Skipping git (--skip-git)");
  }

  log("Creating GitHub Release + uploading assets");
  ensureGh();

  const uploadArgs = [
    "release",
    "create",
    tag,
    "--repo",
    REPO,
    "--title",
    `Civitai Browser ${tag}`,
    "--notes",
    releaseNotes,
  ];

  if (dryRun) {
    console.log(`[dry-run] gh ${uploadArgs.join(" ")}`);
    for (const f of files) {
      console.log(`[dry-run] upload ${f.full}`);
      if (f.sig) console.log(`[dry-run] upload ${f.sig}`);
    }
    console.log(`[dry-run] upload ${latestPath}`);
  } else {
    // If release already exists, delete and recreate (idempotent re-release)
    const existing = spawnOk("gh", ["release", "view", tag, "--repo", REPO], {
      stdio: "pipe",
      encoding: "utf8",
    });
    if (existing.status === 0) {
      console.log(`Release ${tag} exists — deleting to recreate…`);
      run("gh", ["release", "delete", tag, "--repo", REPO, "--yes"]);
    }

    // path#name → GitHub asset name (spaces become dots; keep URL stable)
    const assetArgs = [];
    for (const f of files) {
      assetArgs.push(`${f.full}#${f.githubName}`);
      if (f.sig) assetArgs.push(`${f.sig}#${f.githubName}.sig`);
    }
    assetArgs.push(latestPath);

    run("gh", [...uploadArgs, ...assetArgs]);
  }

  console.log(`
✔ Release ${tag} ready

Updater endpoint:
  https://github.com/${REPO}/releases/latest/download/latest.json

Installer:
  https://github.com/${REPO}/releases/download/${tag}/${updaterArtifact.name}

Next:
  1. Install an older build (or keep current if you just bumped)
  2. Open the app — it checks for updates ~1.5s after launch
  3. Or Settings → Check for updates
`);
}

main();
