<img src="public/sat-tracker-icon.svg" height="100" alt="Sat Tracker logo">

# Sat Tracker

Track satellites in real time, predict passes over your location, and find
objects in the sky with the mobile AR view. Sat Tracker runs as a hosted web
app, an installable PWA, and a desktop Electron app.

- **Web app:** https://sat-tracker.ziona.dev
- **Desktop downloads:** https://github.com/Zzza38/sat-tracker/releases/latest
- **Changes in 1.1.0:** [CHANGELOG.md](CHANGELOG.md)

## Install a desktop release

Open the latest GitHub Release and choose the file for your platform:

- Windows 10/11 x64: setup `.exe` or portable `.exe`
- macOS 12+ on Intel or Apple silicon: `.dmg` or `.zip`
- Linux x64: `.AppImage` or `.deb`

The current community builds are not code-signed or notarized. Windows may
show SmartScreen and macOS may require **Control-click → Open**. Sat Tracker
does not include an auto-updater, so install new releases from GitHub.

## Features

- Manual TLE, 3LE, and OMM JSON ingestion
- CelesTrak fetch by NORAD ID or configurable source URL
- Live propagation, look angles, ground tracks, and sun/shadow state
- Pass prediction with AOS, LOS, TCA, sky plots, charts, CSV, and ICS export
- 2D map and lazy-loaded Cesium 3D globe
- Mobile AR sky finder with camera and compass calibration
- Multiple observer sites, watchlists, satellite colors, and local persistence
- Installable PWA with cached app assets and a bundled offline starter catalog

Pass alerts are local convenience reminders, not an alarm service. Sat Tracker
must remain open, and browser or OS power-saving rules may pause delivery.

## Data, offline behavior, and privacy

Satellite data is fetched directly from `celestrak.org` and stored locally in
IndexedDB. SGP4 accuracy depends on element age, so refresh stale data before
relying on a pass prediction. The starter catalog is intentionally marked with
its bundled epoch and refreshes as soon as connectivity returns.

The hosted web app uses Vercel Analytics. Desktop builds do not load analytics.
There is no Sat Tracker backend, account system, or cloud database.

The web build supports Chrome/Edge 109+, Firefox 115+, and Safari 16+. Camera,
orientation, notification, and PWA features still depend on platform support
and permissions.

## Development

Requires Node.js 24 and pnpm 11.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm dev             # Electron development app
pnpm dev:web         # Web app at http://localhost:5173
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Desktop packaging:

```bash
pnpm dist:win
pnpm dist:mac
pnpm dist:linux
```

Artifacts are written to `release/`. A tag matching `v*` runs the release
workflow, builds all desktop platforms, and publishes durable GitHub Release
assets. The package version and tag must match, for example package `1.1.0`
with tag `v1.1.0`.

## Static web hosting

```bash
pnpm build:web
```

Publish `dist-web/` from a root domain or URL subdirectory. The generated asset
paths, manifest scope, and PWA start URL are relative. Configure SPA fallback
to `index.html`.

```caddy
sat.example.com {
  root * /var/www/sat-tracker/dist-web
  try_files {path} /index.html
  file_server
}
```

## License

Sat Tracker is available under the [ISC License](LICENSE). Runtime dependency
attribution is recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
