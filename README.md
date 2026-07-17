# Civitai Browser

Windows desktop app to browse Civitai images that include generation metadata / ComfyUI workflows, with a masonry gallery and **native drag-out into ComfyUI**.

## Stack

- Tauri 2 + React 19 + TypeScript + Vite
- Tailwind CSS v4
- TanStack Query + Zustand
- masonic (virtualized masonry)
- `tauri-plugin-drag` for OS file drag into ComfyUI
- `tauri-plugin-updater` for signed updates from GitHub Releases

## Prerequisites

- Node.js 20+ and pnpm
- Rust (rustup) + MSVC Build Tools on Windows
- WebView2 (included on modern Windows 10/11)

## Develop

```bash
pnpm install
pnpm tauri dev
```

## Features

- Filters: sort, period, NSFW, username, model / version ID, base models
- Default **Workflow only** mode (client-side filter + smart pagination fill)
- Virtualized masonry grid with blurhash placeholders
- Detail panel: prompt, negative, workflow JSON (copy / save)
- **Drag an image onto the ComfyUI canvas** (caches original PNG first)
- Download / reveal in Explorer
- Optional Civitai API token in Settings
- Check for updates on launch and from Settings

## Release (local build → GitHub Releases)

1. Generate a signing keypair once (keep the private key secret):

   ```bash
   pnpm tauri signer generate -w %USERPROFILE%\.tauri\civitai-browser.key
   ```

   Put the **public** key into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`.

2. Bump `version` in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.

3. Update the updater endpoint repo URL in `tauri.conf.json` if needed:

   `https://github.com/fabwaseem/civitai-browser/releases/latest/download/latest.json`

4. Build with the private key available:

   ```bash
   set TAURI_SIGNING_PRIVATE_KEY_PATH=%USERPROFILE%\.tauri\civitai-browser.key
   pnpm tauri build
   ```

5. Generate the updater manifest:

   ```bash
   pnpm release:manifest -- --repo fabwaseem/civitai-browser --notes "What changed"
   ```

6. Create a GitHub Release tagged `vX.Y.Z` and upload:
   - the NSIS installer / updater artifact from `src-tauri/target/release/bundle/nsis/`
   - the matching `.sig` file
   - `latest.json`

7. Install an older build and confirm Settings → **Check for updates** finds the new release.

## Notes

- Civitai has no server-side “has workflow” filter. The app requests `withMeta=true` and filters client-side.
- Prefer dragging the cached **original** file into ComfyUI so embedded PNG workflow metadata is preserved.
