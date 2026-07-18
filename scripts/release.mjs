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

function loadDotEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
  console.log("Loaded .env");
}

/** Prefer explicit release PAT, then generic tokens (gh CLI reads GH_TOKEN). */
function applyGhToken() {
  const token =
    process.env.RELEASES_GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    "";
  if (!token) return false;
  process.env.GH_TOKEN = token;
  process.env.GITHUB_TOKEN = token;
  return true;
}

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
  } else {
    fail(
      [
        "GitHub CLI (gh) is required for releases.",
        "Install:",
        "  winget install --id GitHub.cli",
        "Then:",
        "  gh auth login",
        "Or set GH_TOKEN / RELEASES_GITHUB_TOKEN in .env",
        "Or open a new terminal after install so PATH updates.",
      ].join("\n"),
    );
  }

  const probe = spawnOk(
    "gh",
    ["api", `repos/${REPO}`, "--jq", ".full_name"],
    { stdio: "pipe", encoding: "utf8" },
  );
  if (probe.status !== 0) {
    fail(
      [
        `Cannot access ${REPO} via gh.`,
        "Set GH_TOKEN or RELEASES_GITHUB_TOKEN in .env (repo Contents: write),",
        "or run: gh auth login",
        (probe.stderr || probe.stdout || "").trim(),
      ].join("\n"),
    );
  }
  console.log(`Release target: ${(probe.stdout || "").trim()}`);
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
 * GitHub Release download URLs replace spaces with dots.
 * Keep the Tauri-produced filename; only rewrite the URL/name mapping.
 */
function githubDownloadName(localName) {
  return localName.replace(/ /g, ".");
}

/**
 * Only artifacts for this release version (avoids uploading leftover
 * Civitai Browser_0.1.0_… next to newer builds).
 */
function findNsisArtifacts(version) {
  const nsisDir = path.join(root, "src-tauri", "target", "release", "bundle", "nsis");
  if (!fs.existsSync(nsisDir)) return { nsisDir, files: [] };
  const token = `_${version}_`;
  // Prefer real build outputs in nsis root only (ignore staged copies)
  const rootNames = fs
    .readdirSync(nsisDir)
    .filter((f) => f.includes(token) && !f.startsWith("civitai-browser-"));
  const zips = rootNames.filter((f) => f.endsWith(".nsis.zip"));
  const exes = rootNames.filter(
    (f) => f.endsWith("-setup.exe") || (f.endsWith(".exe") && !f.endsWith(".sig")),
  );
  const picked = [...zips, ...exes];
  const files = [];
  for (const name of picked) {
    const full = path.join(nsisDir, name);
    if (!fs.statSync(full).isFile()) continue;
    const sig = `${full}.sig`;
    files.push({
      name,
      githubName: githubDownloadName(name),
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
  // GitHub serves spaces as dots — URL must use the dotted name
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
  loadDotEnv();
  applyGhToken();

  const dryRun = hasFlag("dry-run");
  const skipBuild = hasFlag("skip-build");
  const skipGit = hasFlag("skip-git");
  const forceTag = hasFlag("force-tag");
  const bump = arg("bump"); // patch | minor | major
  const explicitVersion = arg("version");
  const notes =
    arg("notes") ||
    process.env.RELEASE_NOTES ||
    null;

  log("Preflight");
  ensureGh();

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

      const localTag = spawnOk("git", ["rev-parse", tag], {
        stdio: "pipe",
        encoding: "utf8",
      });
      if (localTag.status === 0) {
        if (!forceTag) {
          fail(
            `Tag ${tag} already exists locally. Use --force-tag to recreate, or bump the version.`,
          );
        }
        spawnOk("git", ["tag", "-d", tag], { stdio: "pipe" });
      }
      run("git", ["tag", "-a", tag, "-m", releaseNotes]);
      run("git", ["push", "origin", "HEAD"]);
      if (forceTag) {
        run("git", ["push", "origin", tag, "--force"]);
      } else {
        run("git", ["push", "origin", tag]);
      }
    }
  } else {
    log("Skipping git (--skip-git)");
  }

  log("Creating GitHub Release + uploading assets");

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

    // Stage renamed copies so spaces become dots (GitHub asset names)
    const staging = path.join(root, ".release-staging");
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    const stagedUploads = [];
    for (const f of files) {
      const staged = path.join(staging, f.githubName);
      fs.copyFileSync(f.full, staged);
      stagedUploads.push(staged);
      if (f.sig) {
        const stagedSig = path.join(staging, `${f.githubName}.sig`);
        fs.copyFileSync(f.sig, stagedSig);
        stagedUploads.push(stagedSig);
      }
    }
    const stagedLatest = path.join(staging, "latest.json");
    fs.copyFileSync(latestPath, stagedLatest);
    stagedUploads.push(stagedLatest);

    run("gh", [...uploadArgs, ...stagedUploads]);
    fs.rmSync(staging, { recursive: true, force: true });

    // Sanity: installer URL in latest.json must exist
    const checkUrl = `https://github.com/${REPO}/releases/download/${tag}/${updaterArtifact.githubName}`;
    console.log(`Verifying ${checkUrl}`);
    const verify = spawnOk(
      "curl.exe",
      ["-s", "-o", "NUL", "-w", "%{http_code}", "-L", checkUrl],
      { stdio: "pipe", encoding: "utf8" },
    );
    const code = (verify.stdout || "").trim();
    if (code !== "200") {
      fail(
        `Uploader mismatch: ${checkUrl} returned HTTP ${code}. latest.json URL does not match uploaded assets.`,
      );
    }
    console.log(`✓ Installer URL OK (HTTP ${code})`);
  }

  console.log(`
✔ Release ${tag} ready

Updater endpoint:
  https://github.com/${REPO}/releases/latest/download/latest.json

Installer:
  https://github.com/${REPO}/releases/download/${tag}/${updaterArtifact.githubName}

Next:
  1. Install an older build (or keep current if you just bumped)
  2. Open the app — it checks for updates ~1.5s after launch
  3. Or Settings → Check for updates
`);
}

main();
