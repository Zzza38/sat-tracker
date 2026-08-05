# AGENTS.md

## Cursor Cloud specific instructions

Sat Tracker is a single, client-only app (React + TypeScript + Vite + Electron) that
runs in the browser and as an Electron desktop app from one codebase. There is no
backend, database, or secrets to configure. Standard commands live in `package.json`
`scripts` and `README.md`; a few non-obvious notes:

- Package manager is **pnpm** (`pnpm-lock.yaml`). The update script runs `pnpm install`.
- Web dev server: `pnpm run dev:web` serves the SPA at `http://localhost:5173` (port
  fixed in `vite.web.config.ts`, `allowedHosts: true`). This is the easiest way to test
  in Cursor Cloud. `pnpm run dev` launches the Electron desktop app, which needs a
  display and is not usable headlessly here.
- `dev`/`dev:web`/build scripts first run `node scripts/copy-cesium.mjs` to stage the
  Cesium 3D assets into `public/cesium` (dev) or the build output dir. If the 3D globe
  assets look missing, that copy step did not run.
- Quality gates: `pnpm run lint`, `pnpm run typecheck`, `pnpm run test` (Vitest + jsdom),
  and `pnpm run build:web` all pass out of the box.
- Live catalog data is fetched anonymously from `celestrak.org` (needs outbound
  network). Offline, the app uses IndexedDB-cached TLEs or a bundled starter
  catalog; manual TLE/OMM paste always works. The web build is a PWA
  (`vite-plugin-pwa`) that caches the app shell after the first visit.
- Persistence is client-side IndexedDB (via Dexie), so tracked satellites/settings
  persist in the browser profile between runs.
- Brand/favicon assets live in `public/` (`sat-tracker-icon.svg`, `favicon.ico`,
  `apple-touch-icon.png`). Keep those in sync when changing the logo.
