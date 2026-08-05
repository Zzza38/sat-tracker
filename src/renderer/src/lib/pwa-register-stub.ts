/** No-op stand-in used by Electron / Vitest builds that do not ship a service worker. */
export function registerSW(_options?: { immediate?: boolean }) {
  void _options;
  return () => {};
}
