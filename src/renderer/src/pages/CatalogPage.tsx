import { useEffect, useMemo, useRef, useState, useDeferredValue } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { searchSatellites, sortSatellites } from "@/shared/catalog/search";
import { parseNoradIdsDetailed } from "@/shared/catalog/service";
import { formatFetchTooltip, formatRelativeAge } from "@/shared/utils/date";
import { useApp } from "../context/AppContext";
import { Button } from "../components/ui/button";
import { TleFreshnessBadge } from "../components/TleFreshnessBadge";

const CATALOG_CHUNK_SIZE = 150;
const SYNCING_EMPTY_MESSAGE = "Downloading satellite data. The list appears as soon as the first feed finishes.";

export function CatalogPage() {
  const {
    satellites,
    watchlistIds,
    catalogSyncing,
    selectedSatelliteId,
    selectSatellite,
    setPage,
    addManualTle,
    addNorad,
    addNoradBulk,
    toggleWatchlist
  } = useApp();
  const [query, setQuery] = useState("");
  const [noradId, setNoradId] = useState("");
  const [manualTle, setManualTle] = useState("");
  const [bulkNoradIds, setBulkNoradIds] = useState("");
  const [pasteMode, setPasteMode] = useState<"tle" | "norad">("tle");
  const [showManual, setShowManual] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusIsError, setStatusIsError] = useState(false);
  const [visibleCount, setVisibleCount] = useState(CATALOG_CHUNK_SIZE);
  const [togglingIds, setTogglingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [trackedOnly, setTrackedOnly] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const tableViewportRef = useRef<HTMLDivElement | null>(null);
  const listViewportRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const watchlistSet = useMemo(() => new Set(watchlistIds), [watchlistIds]);
  const filtered = useMemo(() => {
    const scoped = trackedOnly ? satellites.filter((record) => watchlistSet.has(record.id)) : satellites;
    return sortSatellites(searchSatellites(scoped, deferredQuery), watchlistIds);
  }, [deferredQuery, satellites, trackedOnly, watchlistIds, watchlistSet]);
  const visibleRecords = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount]
  );
  const hasMoreRecords = visibleCount < filtered.length;
  const catalogKey = useMemo(() => satellites.map((record) => record.id).join(" "), [satellites]);
  const hasActiveQuery = deferredQuery.trim() !== "";
  const bulkParse = useMemo(() => parseNoradIdsDetailed(bulkNoradIds), [bulkNoradIds]);

  const trackedCount = watchlistIds.length;

  useEffect(() => {
    setVisibleCount(CATALOG_CHUNK_SIZE);
    tableViewportRef.current?.scrollTo({ top: 0 });
  }, [deferredQuery, catalogKey, trackedOnly]);

  // "/" and Ctrl/Cmd+K jump to search — the catalog routinely holds thousands of objects.
  useEffect(() => {
    function handleShortcut(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typingElsewhere =
        target?.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;

      const isSlash = event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey;
      const isFindCombo = event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey);

      if ((isSlash && !typingElsewhere) || isFindCombo) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  function loadMoreRecords() {
    setVisibleCount((current) => Math.min(current + CATALOG_CHUNK_SIZE, filtered.length));
  }

  function handleTableScroll() {
    const viewport = tableViewportRef.current;
    if (!viewport || !hasMoreRecords) {
      return;
    }

    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    if (distanceFromBottom < 320) {
      loadMoreRecords();
    }
  }

  async function run(action: () => Promise<void>) {
    setStatus(null);
    setBusy(true);
    try {
      await action();
      setStatusIsError(false);
      setStatus("Added.");
      setNoradId("");
      setManualTle("");
      setBulkNoradIds("");
      setShowManual(false);
    } catch (caught) {
      setStatusIsError(true);
      setStatus(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  function openDetails(id: string) {
    selectSatellite(id);
    setPage("details");
  }

  async function toggleTracking(id: string) {
    // Only the clicked row is locked, so tracking several satellites in quick
    // succession works instead of dropping every click after the first.
    if (togglingIds.has(id)) {
      return;
    }
    setTogglingIds((current) => new Set(current).add(id));
    try {
      await toggleWatchlist(id);
      // Tracked rows sort to the top, so follow the row the user just clicked.
      const listRef = window.matchMedia("(min-width: 768px)").matches ? tableViewportRef : listViewportRef;
      listRef.current?.querySelector(`[data-row-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
    } finally {
      setTogglingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  async function runBulkNorad() {
    setStatus(null);
    setBusy(true);
    try {
      const result = await addNoradBulk(bulkNoradIds);
      const parts = [`Added ${result.added.length} satellite${result.added.length === 1 ? "" : "s"}.`];
      if (result.failures.length > 0) {
        parts.push(
          `${result.failures.length} failed (${result.failures.map((failure) => failure.id).join(", ")}).`
        );
      }
      if (result.ignored.length > 0) {
        const shown = result.ignored.slice(0, 5).join(", ");
        parts.push(
          `Ignored ${result.ignored.length} invalid ${result.ignored.length === 1 ? "entry" : "entries"} (${shown}${result.ignored.length > 5 ? ", …" : ""}).`
        );
      }
      setStatus(parts.join(" "));
      setStatusIsError(result.failures.length > 0 || result.ignored.length > 0);
      setBulkNoradIds("");
      setShowManual(false);
    } catch (caught) {
      setStatusIsError(true);
      setStatus(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  const emptyState = hasActiveQuery ? (
    <div className="py-8 text-center text-sm text-[var(--muted)]">
      <p>
        No matches for &ldquo;{deferredQuery.trim()}&rdquo;
        {trackedOnly ? " among tracked satellites" : ""}.
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setQuery("")}>
          Clear search
        </Button>
        {trackedOnly ? (
          <Button variant="secondary" size="sm" onClick={() => setTrackedOnly(false)}>
            Search all satellites
          </Button>
        ) : null}
      </div>
    </div>
  ) : trackedOnly ? (
    <div className="py-8 text-center text-sm text-[var(--muted)]">
      <p>You are not tracking any satellites yet.</p>
      <Button variant="secondary" size="sm" className="mt-3" onClick={() => setTrackedOnly(false)}>
        Show all satellites
      </Button>
    </div>
  ) : catalogSyncing ? (
    <p className="py-8 text-center text-sm text-[var(--muted)]">{SYNCING_EMPTY_MESSAGE}</p>
  ) : (
    <p className="py-8 text-center text-sm text-[var(--muted)]">
      No satellites yet. Add one above or import a group from Settings.
    </p>
  );

  return (
    <section className="panel min-w-0 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Catalog</p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-[var(--text)]">Satellite registry</h1>
          <p className="mt-2 text-sm text-[var(--muted)]" role="status">
            {hasActiveQuery || trackedOnly
              ? `${filtered.length} of ${satellites.length} shown`
              : `${filtered.length} in catalog`}{" "}
            · {trackedCount} tracked
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Button
            variant={trackedOnly ? "default" : "secondary"}
            size="sm"
            aria-pressed={trackedOnly}
            disabled={!trackedOnly && trackedCount === 0}
            title={
              trackedCount === 0
                ? "Track a satellite first to use this filter"
                : trackedOnly
                  ? "Show every satellite in the catalog"
                  : "Show only satellites you track"
            }
            onClick={() => setTrackedOnly((current) => !current)}
          >
            Tracked only
          </Button>
          <input
            ref={searchInputRef}
            type="search"
            aria-label="Search satellites"
            className="max-w-sm min-w-[12rem] flex-1"
            placeholder="Search name, NORAD, designator  ( / )"
            value={query}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                setQuery("");
              }
            }}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      <div className="mt-6 rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] p-4">
        <p className="text-sm font-medium text-[var(--text)]">Add satellite</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="min-w-[180px] flex-1 space-y-1.5">
            <span className="text-xs font-medium text-[var(--faint)]">NORAD ID</span>
            <input
              value={noradId}
              onChange={(event) => setNoradId(event.target.value)}
              placeholder="25544"
              onKeyDown={(event) => {
                if (event.key === "Enter" && noradId.trim()) {
                  void run(() => addNorad(noradId.trim()));
                }
              }}
            />
          </label>
          <Button disabled={busy || !noradId.trim()} onClick={() => run(() => addNorad(noradId.trim()))}>
            {busy ? "Adding..." : "Add"}
          </Button>
          <Button variant="secondary" onClick={() => setShowManual((current) => !current)}>
            {showManual ? <ChevronUp size={14} className="mr-1 inline" /> : <ChevronDown size={14} className="mr-1 inline" />}
            Paste TLE
          </Button>
        </div>

        {showManual ? (
          <div className="mt-4 space-y-3 border-t border-[var(--line)] pt-4">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={pasteMode === "tle" ? "default" : "secondary"}
                aria-pressed={pasteMode === "tle"}
                onClick={() => setPasteMode("tle")}
              >
                Orbit data (TLE/OMM)
              </Button>
              <Button
                size="sm"
                variant={pasteMode === "norad" ? "default" : "secondary"}
                aria-pressed={pasteMode === "norad"}
                onClick={() => setPasteMode("norad")}
              >
                NORAD IDs
              </Button>
            </div>
            {pasteMode === "tle" ? (
              <>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-[var(--faint)]">Manual TLE / OMM</span>
                  <textarea
                    className="mono text-xs leading-relaxed"
                    value={manualTle}
                    onChange={(event) => setManualTle(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && manualTle.trim() && !busy) {
                        event.preventDefault();
                        run(() => addManualTle(manualTle));
                      }
                    }}
                    placeholder={"1 25544U ...\n2 25544 ...  (2LE/3LE) or OMM JSON"}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoComplete="off"
                    wrap="off"
                  />
                  <p className="text-xs leading-relaxed text-[var(--faint)]">
                    Paste a two-line element set — two lines starting with <span className="mono">1</span> and{" "}
                    <span className="mono">2</span>, optionally with the satellite name on a first line — or an OMM
                    JSON record. Get these from celestrak.org (search a satellite, download TLE/JSON).
                  </p>
                </label>
                <Button
                  variant="secondary"
                  disabled={busy || !manualTle.trim()}
                  onClick={() => run(() => addManualTle(manualTle))}
                >
                  Add from paste
                </Button>
              </>
            ) : (
              <>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-[var(--faint)]">Bulk NORAD IDs</span>
                  <textarea
                    className="mono text-xs leading-relaxed"
                    value={bulkNoradIds}
                    onChange={(event) => setBulkNoradIds(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && bulkNoradIds.trim() && !busy) {
                        event.preventDefault();
                        void runBulkNorad();
                      }
                    }}
                    placeholder={"25544\n43013\n48274\n\nOr comma-separated: 25544, 43013, 48274"}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoComplete="off"
                    wrap="off"
                  />
                </label>
                {bulkNoradIds.trim() ? (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {bulkParse.ids.length} valid ID{bulkParse.ids.length === 1 ? "" : "s"}
                    {bulkParse.ignored.length > 0 ? ` · ${bulkParse.ignored.length} will be ignored` : ""}
                  </p>
                ) : null}
                <Button variant="secondary" disabled={busy || !bulkNoradIds.trim()} onClick={() => void runBulkNorad()}>
                  Add from paste
                </Button>
              </>
            )}
          </div>
        ) : null}

        {status ? <p role={statusIsError ? "alert" : "status"} className={`mono mt-3 text-sm ${statusIsError ? "text-[var(--danger)]" : "text-[var(--accent)]"}`}>{status}</p> : null}
      </div>

      {catalogSyncing ? (
        <p className="mono mt-4 text-sm text-[var(--muted)]" role="status">
          Updating catalog in the background...
        </p>
      ) : null}

      {busy ? (
        <p className="mono mt-4 text-sm text-[var(--muted)]" role="status">
          Adding satellite…
        </p>
      ) : null}

      <div ref={listViewportRef} className="catalog-list mt-5 space-y-2 md:hidden">
        {filtered.length === 0 ? (
          emptyState
        ) : (
          visibleRecords.map((record) => {
            const tracked = watchlistSet.has(record.id);
            return (
              <div
                key={record.id}
                data-row-id={record.id}
                className={`flex items-center justify-between gap-3 rounded-[10px] border border-[var(--line)] p-3 ${
                  tracked ? "bg-[var(--surface-2)]" : "bg-transparent"
                }${record.id === selectedSatelliteId ? " [box-shadow:inset_2px_0_0_var(--accent)]" : ""}`}
              >
                <button type="button" className="link-button min-w-0 flex-1 text-left font-medium" onClick={() => openDetails(record.id)}>
                  <p className="truncate text-sm font-medium text-[var(--text)] cursor-pointer hover:text-[var(--accent)]">
                    {record.name}
                  </p>
                  <p className="mono mt-1 text-xs text-[var(--muted)]">
                    {record.noradId} · {formatRelativeAge(record.fetchedAt)}
                  </p>
                  <div className="mt-1.5">
                    <TleFreshnessBadge satellite={record} />
                  </div>
                </button>
                <Button
                  className="w-[92px] shrink-0"
                  variant={tracked ? "default" : "secondary"}
                  size="sm"
                  disabled={togglingIds.has(record.id)}
                  aria-pressed={tracked}
                  onClick={() => void toggleTracking(record.id)}
                >
                  {tracked ? "Tracking" : "Track"}
                </Button>
              </div>
            );
          })
        )}
      </div>

      <div
        ref={tableViewportRef}
        className="catalog-table mt-5 hidden overflow-auto md:block"
        onScroll={handleTableScroll}
      >
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>NORAD ID</th>
              <th>Data age</th>
              <th>Fetched</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5}>{emptyState}</td>
              </tr>
            ) : (
              visibleRecords.map((record) => {
                const tracked = watchlistSet.has(record.id);
                return (
                  <tr
                    key={record.id}
                    data-row-id={record.id}
                    className={
                      [
                        tracked ? "bg-[var(--surface-2)]" : "",
                        record.id === selectedSatelliteId ? "[box-shadow:inset_2px_0_0_var(--accent)]" : ""
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                  >
                    <td>
                      <button
                        type="button"
                        className="link-button text-left font-medium text-[var(--text)] hover:text-[var(--accent)] cursor-pointer"
                        onClick={() => openDetails(record.id)}
                      >
                        {record.name}
                      </button>
                    </td>
                    <td className="mono">{record.noradId}</td>
                    <td>
                      <TleFreshnessBadge satellite={record} />
                    </td>
                    <td className="mono text-xs text-[var(--muted)]" title={formatFetchTooltip(record.fetchedAt)}>
                      {formatRelativeAge(record.fetchedAt)}
                    </td>
                    <td>
                      <div className="flex justify-end gap-2">
                        <Button
                          className="w-[92px]"
                          variant={tracked ? "default" : "secondary"}
                          size="sm"
                          disabled={togglingIds.has(record.id)}
                          aria-pressed={tracked}
                          title={tracked ? "Click to stop tracking" : "Click to track this satellite"}
                          onClick={() => void toggleTracking(record.id)}
                        >
                          {tracked ? "Tracking" : "Track"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {hasMoreRecords ? (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={loadMoreRecords}>
            Load more ({visibleRecords.length}/{filtered.length})
          </Button>
        </div>
      ) : null}
    </section>
  );
}
