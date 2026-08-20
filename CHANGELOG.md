# Changelog

## 1.1.0 - 2026-08-20

### Added

- Mobile AR sky finder with camera, compass calibration, and manual aiming.
- Installable PWA with an offline app shell and bundled starter catalog.
- Durable GitHub Release workflow for tagged desktop builds.
- Catalog removal, release smoke tests, CSP, and third-party notices.

### Fixed

- Pass boundaries, long-window resolution, worker cancellation, and cache correctness.
- Android web notifications and blocked reminder-storage handling.
- Stale offline and service-worker catalog timestamps.
- IPv6 private-network URL validation and spreadsheet-safe exports.
- Tracker isolation, titlebar keyboard navigation, observer autosave errors,
  and pass-list accessibility.

### Changed

- Desktop analytics are disabled. Hosted web analytics remain enabled.
- Cesium was upgraded to remove all reported production dependency advisories.
- The supported web baseline is Chrome/Edge 109+, Firefox 115+, and Safari 16+.
