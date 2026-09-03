# Release review findings

Status as of 1.1.1 (2026-09-03): 1.1.0 shipped the original checklist.
1.1.1 stops the WASM pass scanner from treating decayed `satellite.js`
samples as horizon crossings. The notes below are the 2026-08-19 review
of `f14b7e3`.

Review of `master` (HEAD `f14b7e3`, 2026-08-19) for a new public release. Quality gates pass (`pnpm lint`, `typecheck`, `test`; CI builds web + Electron and packages Windows, macOS, and Linux). The tree is **not** ready to ship.

Compared against published tag `v1.0.0` (`11d319d`, 2026-06-06): **47 commits** ahead, including AR sky finder, PWA/offline, favicons, and AR heading fixes.

---

## Blockers

### Version `1.0.0` already shipped; current tree is not that release

`package.json` is still `"version": "1.0.0"`. GitHub already published [Version 1.0.0](https://github.com/Zzza38/sat-tracker/releases/tag/v1.0.0) on 2026-06-07 with Win/macOS/Linux installers. Shipping current `master` as `1.0.0` collides with that tag and misrepresents the bits.

Need a bump (`1.1.0` is the honest one given AR + PWA), a new tag, and a new GitHub Release. There is no CHANGELOG and no version-bump process.

### No durable download path for current builds

CI packages on every push and keeps artifacts **14 days** (`.github/workflows/ci.yml`). README tells people to download those CI artifacts, not GitHub Releases. Artifacts expire; the only durable download is the June `v1.0.0` binaries. There is no `release.yml`, no `electron-builder` publish config (scripts use `--publish never`), and no auto-update.

### LICENSE claimed, not present

`package.json` declares `"license": "ISC"`. There is no `LICENSE` / `COPYING` / `NOTICE` in the tree. GitHub reports no license. Redistributing Electron, Cesium (Apache-2.0), and satellite.js without a LICENSE file is incomplete for a public OSS drop.

### Pass cache can store “no passes” for a valid window

`src/shared/passes/predictor.worker.ts` drops superseded jobs by posting `{ type: "complete", passes: [] }`. The host treats that as a real result and writes it into IndexedDB (`src/shared/passes/predictor.ts`, 10-minute TTL).

Overlapping Passes/Tracker/AR predictions share one worker. Changing the day window, switching pages, or starting a second compute while the first is queued can cache an empty result. Reloading Passes then shows an empty table until the cache expires.

`cancelPassPrediction` is exported but unused. The worker `type: "cancel"` message is a no-op (`latestId` is not updated).

### PWA can treat week-old CelesTrak data as freshly fetched

Web PWA caches `https://celestrak.org/*` with NetworkFirst, a 10s timeout, and a 7-day TTL (`vite.web.config.ts`). `createSatelliteRecord` always sets `fetchedAt` to now (`src/shared/tle/parser.ts`). Catalog refresh decides staleness from `fetchedAt`, not element epoch (`src/renderer/src/context/AppContext.tsx`).

If CelesTrak is slow or down, Workbox can return last week’s GP JSON, the app stamps it as just fetched, and automatic refresh is suppressed for the full interval (default 12 hours). Epoch badges still say “Stale”, but look angles and passes keep using old elements. Electron is unaffected (no service worker).

---

## Should fix before a public drop

### README is a builder guide, not a release page

Missing for someone installing a release:

- No link to GitHub Releases as the primary desktop install path (web app: https://sat-tracker.ziona.dev)
- No “download the `.exe` / `.dmg` / `.AppImage`” steps
- Scripts documented as `npm run` while the repo is **pnpm** (`packageManager` in `package.json`, `pnpm-lock.yaml`)
- Features list omits AR sky finder (the largest post-1.0.0 work)
- No known limitations: unsigned Mac (`identity: null`), no notarization, Windows SmartScreen, Mac **arm64-only**, Linux **amd64-only**, no auto-update, CelesTrak needs network, SGP4 depends on TLE age

### Vercel Analytics in every runtime, including Electron

`src/renderer/src/App.tsx` mounts `<Analytics />` with no `isElectronRuntime()` gate and no privacy note in README or Settings. Acceptable for the hosted web app; not acceptable for a public desktop binary that phones home with no opt-in.

### Temporary AR debug UI still in the product

`src/renderer/src/lib/arDebug.ts` is labeled temporary field instrumentation (“Remove this module and its call sites once the field issue is resolved”). `ArPage.tsx` still exposes a “Troubleshooting · temporary” panel.

### Tracker hides the whole watchlist when the focused satellite fails to propagate

Per-satellite `computeOrbitSnapshot` failures are isolated when building `trackedSatellites`, but `TrackerPage.tsx` still bails out if the focused snapshot is null. Selecting one decayed or malformed object replaces the live tracker with an empty-state panel. Details and AR already degrade per object.

### Multi-satellite pass scans coarsen past short LEO passes

WASM bulk prediction caps the time grid at 10,000 samples and raises `stepSeconds` to fit (`src/shared/passes/predictor-bulk.ts`). A 14-day Passes window (requested 45s) becomes ~121s steps whenever two or more satellites are tracked. Horizon crossings shorter than one coarse step never reach the 20s refiner, so high-elevation grazing passes can disappear from the multi-sat path while the single-sat JS path still uses 45s.

---

## Incomplete / stubbed surfaces

- `removeSatellite` in `src/shared/catalog/service.ts` is never wired to the UI. After importing the default `active` CelesTrak group, the local catalog cannot be pruned except by clearing site data.
- `cancelPassPrediction` is documented but unused; worker cancel does not change `latestId`.
- `wasm-multithread-stub.ts`, `node-module-browser-stub.ts`, and `pwa-register-stub.ts` are intentional build aliases, not unfinished product surfaces.
- No `TODO` / `FIXME` / `HACK` markers in application source.

---

## Test / quality-gate gaps

Lint, typecheck, and 89 unit tests pass. CI runs `pnpm build` plus desktop packaging. No skipped tests, `.only`, or `.todo`.

Uncovered paths that can rot with CI still green:

- IndexedDB / Dexie: schema, `ensureSeedData`, `migrateSettings`, watchlist, pass cache (`src/shared/db/index.ts`, `src/shared/catalog/service.ts`, `src/shared/passes/predictor.ts`)
- Catalog I/O: CelesTrak GP fetch success/error, TLE catalog parse, `addFromNoradId` / `importFromTleSource` / `refreshSatellite` / `addManualElements`, AppContext bootstrap
- TLE/OMM parser failures: OMM JSON (`ISS_OMM` fixture unused), empty input, bad checksum, 3LE name line
- Electron main handlers (`src/main/index.ts`), PWA registration, React page flows

Weak assertions worth tightening:

- Propagation snapshot only checks `lat ∈ (-90, 90)` and `rangeKm > 0`
- Pass isolation test only asserts `expect.any(Array)`
- IPC “path traversal” lookalike fails on length > 255, not `../`

ESLint is recommended TypeScript rules only (`no-explicit-any` off; no react-hooks / jsx-a11y). Not a ship-stopper.

---

## Packaging notes (not blockers)

Electron-builder config, icons, Cesium copy scripts, PWA registration (web-only), and production Electron security (`contextIsolation`, `sandbox`, `nodeIntegration: false`, IPC allowlist) are in good enough shape that a tagged release would actually build.

Polish:

| Item | Where |
|---|---|
| Empty `keywords`, no `repository` / `homepage` | `package.json` |
| PWA icon sizes lie (`192` assets are 256×256) | `vite.web.config.ts` vs `public/` |
| Cesium precache is large (~17MB+) | `vite.web.config.ts` workbox `globPatterns` |
| No CSP | renderer HTML / Electron `webPreferences` |
| Dev-only Tailscale allowlist in main | `src/main/index.ts` (`desktop-zion` / `desktop-zion.tail4dd51a.ts.net`) |
| No Windows/Mac signing | `identity: null`, no `CSC_*` |
| Linux icons stop at 512 | `build/icons/` |
| Third-party notices missing | Cesium Apache-2.0 attribution for binaries |
| `npm run` inside `package.json` scripts | works on CI (npm is present); inconsistent with pnpm |

---

## Minimum before tagging

1. Bump version to `1.1.0`.
2. Add a `LICENSE` file matching ISC, plus a short third-party notice.
3. Tag and publish GitHub Release assets from CI (or a dedicated release workflow). Point README at that URL and the live web app.
4. Rewrite the top of README for users (web vs desktop, unsigned Mac, arch limits). Switch examples to `pnpm`.
5. Do not treat superseded pass jobs as empty successes; do not cache those results.
6. Do not mark service-worker CelesTrak fallbacks as freshly fetched.
7. Disable or gate `@vercel/analytics` in Electron, and mention it for the web build.
8. Remove or clearly hide the temporary AR debug panel if the field issue is considered resolved.

---

## Additional full-codebase audit findings

These findings were confirmed in a separate read-only audit and were not already covered above.

### Prediction windows can fabricate AOS for a pass already in progress

`predictPassesForSatellite` initializes `passStart` to the requested window start whenever the satellite is already above the horizon (`src/shared/passes/predictor-core.ts`). If the satellite later sets inside the window, the resulting pass reports the window start as AOS even though the real horizon crossing occurred earlier.

Passes starts its window at the current minute, so an already-visible satellite can be shown as rising "now". The clipped AOS also affects duration, CSV/ICS exports, charts, and reminder timing. The end boundary deliberately excludes unfinished passes rather than fabricating LOS, but the start boundary does not follow the same policy.

### Pass alerts only work while the app is running

`PassReminderService` polls localStorage every 15 seconds from a mounted React component. There is no service-worker notification scheduling, Push API integration, Electron background scheduler, or OS-level scheduled notification.

Closing or suspending the browser, installed PWA, or Electron app prevents delivery. On reopening, reminders more than five minutes past AOS are silently deleted. The UI presents these as normal "Notify" / "Alert set" alerts without explaining that the app must remain open.

### Electron satellite picker has broken keyboard navigation and ARIA roles

`ElectronTitlebar.tsx` searches for `[role="option"]` when opening the satellite picker and when handling Arrow/Home/End keys. The rendered entries use `role="menuitemradio"`, so the query returns no entries, focus is not moved, and keyboard navigation does nothing.

The surrounding element is declared as a `listbox`, while the trigger says `aria-haspopup="menu"` and the children are menu radio items. The widget mixes incompatible listbox and menu patterns.

### Observer autosave failures are unhandled

The debounced save in `SettingsPage.tsx` invokes `updateObserver(observerToSave).then(...)` without a rejection handler. If IndexedDB is unavailable, blocked, out of quota, or otherwise rejects, the app produces an unhandled promise rejection and never shows a save failure to the user.

### Mobile pass cards nest interactive controls

Each mobile pass card in `PassesPage.tsx` is a focusable `div role="button"`, but it contains a real Notify button. Nested interactive controls create invalid/confusing focus and activation semantics for screen readers and keyboard users. The desktop pass table uses a related pattern with a focusable clickable row containing a button.

### Production dependency audit reports eight advisories

`pnpm audit --prod` exits nonzero with **five moderate and three low** transitive advisories through Cesium. The locked vulnerable packages are `protobufjs` and DOMPurify. Reported classes include parser denial of service, prototype/configuration pollution, and sanitizer bypass/XSS conditions.

The audit did not prove that Sat Tracker reaches every affected API, so these are shipped dependency risks rather than confirmed application exploits. They still need remediation or explicit risk acceptance before a public release.

### PWA install assumes root-path hosting

The web manifest hardcodes `start_url: "/"` in `vite.web.config.ts`. A deployment under a URL prefix can install successfully but launch at the host root instead of the Sat Tracker subpath. The README describes generic static hosting without stating that root hosting is required.

### Browser compatibility policy is undefined

The production web build targets `esnext`, which performs essentially no downlevel transformation. README presents Sat Tracker as a general browser/PWA app but does not state that only current evergreen browsers are supported. CI also has no browser-runtime compatibility test.

### Packaged and offline runtime behavior is not smoke-tested

CI verifies lint, typecheck, unit tests, builds, and the existence of packaged files, but it does not launch a packaged Electron app, install any platform artifact, serve and navigate `dist-web`, or test a service-worker-controlled offline reload. A successful package upload therefore does not prove that the distributed application starts or that the advertised offline path works.

---

## Second-pass audit (direct read, 2026-08-20)

A second full read of the tree on `f14b7e3`, excluding everything already recorded above. Quality gates re-confirmed green: 89 tests across 14 files, `pnpm lint` clean, `tsc --noEmit` clean. Each finding below was checked against the code path and, where the behavior depended on a platform API, against the actual runtime.

### High

#### Pass alerts can never fire on Android Chrome, and the failure repeats forever

`notifyPass` delivers web notifications with `new Notification(title, { body })` (`src/renderer/src/lib/platform.ts:33`). Android Chrome does not implement the `Notification` constructor: the object exists on `window` and `Notification.permission` can be `"granted"`, but construction throws `TypeError: Illegal constructor` and directs callers to `ServiceWorkerRegistration.showNotification()` instead. `requestNotificationPermission` only inspects `Notification.permission` (`src/renderer/src/lib/platform.ts:50-54`), so it returns `true` and `toggleReminder` (`src/renderer/src/pages/PassesPage.tsx:291`) records the reminder and renders "Alert set".

The throw is not contained. `PassReminderService` awaits `notifyPass` inside a bare `for` loop with no `try`/`catch`, and `removePassReminder(reminder.id)` sits after the await (`src/renderer/src/components/PassReminderService.tsx:17-22`). The rejection escapes through `void checkReminders()`, so the due reminder is never cleared, every remaining reminder in the same batch is skipped, and the whole sequence retries on the next 15-second tick indefinitely.

The user-visible result on Android is a pass alert that is accepted, never delivered, and never expires, plus a repeating unhandled rejection. Given that the AR sky finder makes handheld Android a primary target, this is the most consequential new defect found. It is distinct from the already-recorded limitation that reminders only fire while the app is open: here the app is open and the notification still cannot be constructed.

### Medium

#### The offline starter catalog stamps itself as fresh and suppresses recovery for a full refresh interval

`seedOfflineCatalog` builds records through `createSatelliteRecord` (`src/shared/catalog/offline-seed.ts:39`), which unconditionally sets `fetchedAt` to the current time. `catalogNeedsRefresh` derives staleness from the oldest `fetchedAt` across the catalog (`src/renderer/src/context/AppContext.tsx:163-167`). A user who first opens the app offline is seeded with nine satellites, all marked as fetched seconds ago, so when connectivity returns the automatic refresh stays suppressed for the full interval, twelve hours by default.

The bundled elements themselves carry epoch `26217`, 2026-08-05, and are compiled into the binary. They were already fifteen days old on the date of this audit and will keep aging for the life of the release with no mechanism to update them. SGP4 error for LEO grows to hundreds of kilometres over that span, so the offline path renders look angles and passes that are confidently wrong.

This shares a symptom with the recorded service-worker issue but has a separate cause and a separate fix: the seed path never touches Workbox and is present in Electron, which has no service worker at all.

#### The custom-source SSRF guard does not cover any IPv6 address

`validateRemoteUrl` rejects local and private targets by comparing `url.hostname` against a list and a set of IPv4 patterns (`src/shared/celestrak/client.ts:14-28`). The IPv6 loopback check is written as `hostname === "::1"` (`src/shared/celestrak/client.ts:22`), but the URL parser returns IPv6 hosts in bracketed form. Running the parser confirms `new URL("http://[::1]/").hostname` is `"[::1]"`, so that branch is unreachable dead code.

Nothing else in the function inspects IPv6. `http://[::1]:8080/tle`, `http://[0:0:0:0:0:0:0:1]/`, `http://[::ffff:127.0.0.1]/` (normalized to `[::ffff:7f00:1]`) and ULA addresses such as `http://[fd00::1]/` all pass validation and are fetched. The IPv4 side holds up better than it looks, because the URL parser normalizes `127.1`, `2130706433` and `0177.0.0.1` to `127.0.0.1` before the regexes run.

A user pasting such a URL into a custom TLE source causes the app to issue requests to loopback and private-network services. In the browser this is bounded by CORS; in the packaged Electron app it is not, which makes it a desktop-binary concern rather than a web one.

#### ICS export omits the DTSTAMP property that RFC 5545 requires

`passesToIcs` emits `UID`, `DTSTART`, `DTEND`, `SUMMARY` and `DESCRIPTION` per event (`src/shared/passes/predictor-core.ts:296-304`). RFC 5545 section 3.6.1 lists `DTSTAMP` as required in a `VEVENT`. Strict importers reject the file outright and lenient ones substitute a value, so a user exporting passes and importing them into a calendar client can get an import error with no explanation. The generator also does not fold content lines at 75 octets, which is a latent problem for long satellite names.

The empty-calendar case is not reachable: both export buttons are `disabled` when `passes.length === 0` (`src/renderer/src/pages/PassesPage.tsx:346,353`).

#### Reminder writes to localStorage are unguarded while reads are guarded

`readPassReminders` wraps its `localStorage` access in `try`/`catch` (`src/renderer/src/lib/passReminders.ts:22-27`), but `writePassReminders` calls `localStorage.setItem` bare (`src/renderer/src/lib/passReminders.ts:31`). Storage access throws rather than returning null when it is blocked, which covers Safari private browsing, Firefox in strict tracking-protection mode, embedded contexts with storage partitioning, and quota exhaustion.

In those environments the app loads and reads an empty reminder list without complaint, and then clicking Notify throws out of `togglePassReminder` (`src/renderer/src/pages/PassesPage.tsx:297`) with no handler. The same file already guards its own `localStorage.setItem` for the day-window slider (`src/renderer/src/pages/PassesPage.tsx:324-328`), so the omission is an inconsistency rather than a deliberate policy.

#### The desktop app has no single-instance lock

`src/main/index.ts` never calls `app.requestSingleInstanceLock()`. The NSIS installer creates a desktop and Start Menu shortcut, so launching the app a second time starts a second main process pointed at the same `userData` directory. Chromium profile locking decides the outcome, which means the second launch either fails opaquely or produces a second window competing for the same IndexedDB, and the user gets no indication which happened.

### Low

#### Default TLE sources display their full URL as their name

`DEFAULT_TLE_SOURCES` calls `createUrlTleSource(url, id)` (`src/shared/tle/sources.ts:4-9`), and that helper sets `name: url` (`src/shared/tle/sources.ts:27-34`). The second argument is the id, not a display name, so all six shipped sources are labelled with the raw query string. Settings renders those labels, and failure messages interpolate them, producing errors of the form `Failed to fetch "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=JSON".`

#### First run fetches six overlapping CelesTrak groups

The default source list requests `stations`, `active`, `visual`, `last-30-days`, `weather` and `science` (`src/shared/tle/sources.ts:4-9`). The `active` group is a superset of `stations`, `visual`, `weather` and `science`, so `fetchInitialSources` (`src/renderer/src/context/AppContext.tsx:106-130`) downloads several megabytes of largely duplicate GP JSON and runs redundant `bulkPut` batches through `importFromTleSource`. Records deduplicate by NORAD id, so the cost is bandwidth and first-run latency rather than storage.

#### CSV export does not neutralize spreadsheet formulas

`csvCell` wraps the satellite name in quotes and doubles embedded quotes (`src/shared/passes/predictor-core.ts:245-247`), which is correct CSV quoting but does not stop Excel and LibreOffice from evaluating a field whose content begins with `=`, `+`, `-` or `@`. The name is user-controlled through the manual TLE paste path in `addManualElements`, so a name crafted or copied from an untrusted source becomes a live formula when the exported file is opened.

#### CI rebuilds dependencies on every push with no cache and no concurrency limit

`.github/workflows/ci.yml` triggers on unfiltered `push`, so every branch push runs the validate job plus a three-OS packaging matrix. `actions/setup-node` is configured without `cache: pnpm` (`.github/workflows/ci.yml:13-17,53-57`), so all four jobs re-download the full dependency tree including Electron and Cesium, and there is no `concurrency` group to cancel superseded runs. This is spend and wall-clock time rather than a correctness problem, but it compounds the already-recorded fact that these artifacts expire after 14 days.

### Checked and found sound

Several suspicions did not survive reading the code and are recorded so they are not re-investigated. `propagate` returns `null` rather than a false-position object when `satrec.error` is set, which the `if (!result)` guard in `computeOrbitSnapshot` (`src/shared/propagation/engine.ts:62-64`) handles correctly. `Globe3D` tears down its `preUpdate` listener, all three `ScreenSpaceEventHandler` instances, its `ResizeObserver` and the `Viewer` itself, and its async `boot` re-checks the `cancelled` flag after every await, so route changes do not leak WebGL contexts. The AR page stops all media tracks, clears `srcObject`, cancels its animation frame and disconnects its `ResizeObserver` on unmount. `exportFile` catches save failures and surfaces them through the error banner. The Dexie schema is still at `version(1)` with no index changes since `v1.0.0`, so the upgrade path for existing users is not at risk. The built main process is ESM with `__dirname` shimmed from `import.meta.dirname`, so the preload path resolves correctly in the packaged app.

### Verdict on release readiness

These findings do not change the existing conclusion, they reinforce it. The tree is still not ready to tag. The Android notification defect is the one item here that belongs alongside the existing blockers, because it ships a feature that cannot work on a platform the AR view is explicitly built for, and it fails loudly and repeatedly rather than degrading. The offline-seed staleness and the IPv6 gap in the source validator should be fixed in the same pass as the two already-recorded freshness and caching bugs, since they touch the same code paths.
