![Logo](public/sat-tracker-icon.svg)
# Sat Tracker

All-in-one satellite tracking app built with TypeScript, React, satellite.js, and Cesium. It runs in the browser and as an Electron desktop app from the same codebase.

## Features

- Manual TLE, 3LE, and OMM JSON ingestion
- CelesTrak auto-fetch by NORAD ID or curated groups
- Live propagation with look angles, sun/shadow state, and ground tracks
- Pass prediction with AOS, LOS, TCA, azimuth arcs, sky plot, and elevation chart
- 2D map tracker with optional lazy-loaded 3D Cesium globe
- IndexedDB persistence for satellites, observer sites, watchlists, and settings
- CSV and ICS export, plus native save dialogs in Electron

## Scripts

```bash
npm run dev             # Electron dev app
npm run dev:web         # Web-only dev server
npm run build           # Electron + web production builds
npm run build:web       # Static web build in dist-web/
npm run build:electron
npm run lint
npm run typecheck
npm run test
npm run test:watch
```

## Desktop builds

Build both Windows desktop artifacts:

```bash
npm run dist
```

The generated files are written to `release/`:

- `Sat Tracker Setup 1.0.0.exe` installer
- `Sat Tracker 1.0.0.exe` portable executable

You can also build them separately:

```bash
npm run dist:installer
npm run dist:portable
npm run dist:mac
npm run dist:linux
```

CI builds desktop artifacts on Windows, macOS, and Linux. Open the latest `CI` workflow run and download the platform artifact you need:

- `sat-tracker-windows`
- `sat-tracker-macos`
- `sat-tracker-linux`

## Web deploy

Build the static site:

```bash
npm run build:web
```

Serve `dist-web/` behind Caddy, nginx, or any static file host. The build copies Cesium assets into `dist-web/cesium/`.

Example Caddy snippet:

```caddy
sat.example.com {
  root * /var/www/sat-tracker/dist-web
  file_server
  try_files {path} /index.html
}
```

## Electron

Production Electron builds output to `out/`:

- `out/main/index.js`
- `out/preload/index.mjs`
- `out/renderer/index.html`

Packaged desktop builds output platform artifacts to `release/`.

## Observer workflow

1. Open **Settings** and set your ground station latitude, longitude, altitude, and minimum elevation.
2. Add satellites in **Catalog** by NORAD ID, manual TLE paste, or CelesTrak group import.
3. Use **Passes** to compute upcoming visible passes for your watchlist.
4. Open **Tracker** for live position and ground track visualization.
5. Use **Details** for orbital elements, current look angles, and next passes.

## Notes

- CelesTrak GP data is fetched directly from `celestrak.org`.
- OMM JSON is stored internally so the app can handle larger catalog numbers as TLE-only sources age out.
- SGP4 accuracy depends on TLE freshness; configure the automatic refresh interval in Settings.
