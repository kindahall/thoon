# Thoon Desktop

Thoon has a Tauri 2 desktop shell for personal macOS use.

## Personal Dev App

Run:

```bash
npm run desktop:dev
```

The Tauri window opens `http://127.0.0.1:3001`. If the Thoon dev server is already running, the desktop shell reuses it. Otherwise it starts `npm run dev -- -p 3001`.

Full Xcode is not required for this personal desktop workflow. Rust and the Xcode Command Line Tools are enough for the current Tauri shell. A full Xcode/Apple signing setup is only needed later if the app must be notarized and distributed cleanly outside your machine.

## Local App Bundle

Run:

```bash
npm run desktop:build
```

This creates a local app bundle at:

```text
src-tauri/target/release/bundle/macos/Thoon.app
```

The current bundle is a shell that opens the local Thoon server at `127.0.0.1:3001`. Start Thoon first with `npm run dev -- -p 3001` or use `npm run desktop:dev` for the smoother development workflow.

The DMG target is intentionally disabled for now because DMG packaging/signing is part of the later distribution path.

## Current Packaging Model

This is a desktop shell around the local Thoon server. It is intentionally not a fully standalone Mac app yet because Thoon uses Next.js server routes, SSR, auth, local data, cron jobs and API handlers. Tauri's official Next.js path is static export, which does not fit the current app without removing those server features.

For a distributable standalone `.app`, the next step is to bundle a local server sidecar:

- build Next with a standalone server output
- bundle a Node runtime and the `.next/standalone` output as Tauri sidecars
- have Rust choose a free localhost port and start the sidecar on app launch
- store local data under the macOS app data directory instead of the repo
- add signing/notarization for macOS distribution

Until that phase is done, use `npm run desktop:dev` for the personal Mac app workflow.
