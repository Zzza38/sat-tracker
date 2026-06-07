import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { searchSatellites, sortSatellites } from "@/shared/catalog/search";
import { useApp } from "../context/AppContext";
import { Button } from "../components/ui/button";

export function CatalogPage() {
  const {
    satellites,
    watchlistIds,
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

  const filtered = useMemo(
    () => sortSatellites(searchSatellites(satellites, query), watchlistIds),
    [query, satellites, watchlistIds]
  );

  const trackedCount = watchlistIds.length;

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

  async function toggleTracking(id: string) {
    await toggleWatchlist(id);
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
      setStatus(parts.join(" "));
      setStatusIsError(result.failures.length > 0);
      setBulkNoradIds("");
      setShowManual(false);
    } catch (caught) {
      setStatusIsError(true);
      setStatus(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Catalog</p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-[var(--text)]">Satellite registry</h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {filtered.length} in catalog · {trackedCount} tracked
          </p>
        </div>
        <input
          className="max-w-sm"
          placeholder="Search name, NORAD, designator"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
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
                onClick={() => setPasteMode("tle")}
              >
                TLE / OMM
              </Button>
              <Button
                size="sm"
                variant={pasteMode === "norad" ? "default" : "secondary"}
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
                    value={manualTle}
                    onChange={(event) => setManualTle(event.target.value)}
                    placeholder="Paste 2LE, 3LE, or OMM JSON"
                  />
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
                    value={bulkNoradIds}
                    onChange={(event) => setBulkNoradIds(event.target.value)}
                    placeholder={"25544\n43013\n48274\n\nOr comma-separated: 25544, 43013, 48274"}
                  />
                </label>
                <Button variant="secondary" disabled={busy || !bulkNoradIds.trim()} onClick={() => void runBulkNorad()}>
                  Add from paste
                </Button>
              </>
            )}
          </div>
        ) : null}

        {status ? <p className={`mono mt-3 text-sm ${statusIsError ? "text-[var(--danger)]" : "text-[var(--accent)]"}`}>{status}</p> : null}
      </div>

      <div className="mt-5 overflow-auto">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>NORAD ID</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-8 text-center text-sm text-[var(--muted)]">
                  No satellites yet. Add one above or import a group from Settings.
                </td>
              </tr>
            ) : (
              filtered.map((record) => {
                const tracked = watchlistIds.includes(record.id);
                return (
                  <tr key={record.id} className={tracked ? "bg-[var(--surface-2)]" : undefined}>
                    <td>{record.name}</td>
                    <td className="mono">{record.noradId}</td>
                    <td>
                      <div className="flex justify-end gap-2">
                        <Button
                          className="w-[92px]"
                          variant={tracked ? "default" : "secondary"}
                          size="sm"
                          disabled={busy}
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
    </section>
  );
}
