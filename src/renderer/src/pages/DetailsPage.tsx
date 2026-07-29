import { useMemo, useState } from "react";
import { computeOrbitSnapshot, getOrbitMetrics } from "@/shared/propagation/engine";
import { epochAgeDays, formatRelativeAge, formatTimestampCompact } from "@/shared/utils/date";
import { useApp } from "../context/AppContext";
import { useTicker } from "../hooks/useTicker";
import { Button } from "../components/ui/button";
import { TleFreshnessBadge } from "../components/TleFreshnessBadge";

// Human-readable labels + (where useful) plain-English glosses for the raw OMM
// element set, so the details panel reads like a summary instead of a JSON dump.
const OMM_FIELD_META: Array<[string[], string, string?]> = [
  [["OBJECT_NAME"], "Object name"],
  [["NORAD_CAT_ID", "NORAD_ID"], "NORAD catalog ID", "The number NORAD/Space-Track assigns to this object."],
  [["INTERNATIONAL_DESIGNATOR", "OBJECT_ID"], "International designator", "Launch-year / sequence / piece code, e.g. 1998-067A."],
  [["ELEMENT_SET_NO", "ELEMENT_SET"], "Element set number"],
  [["EPHEMERIS_TYPE"], "Ephemeris type", "Propagation model the elements are intended for (0 = SGP4)."],
  [["CLASSIFICATION_TYPE"], "Classification"],
  [["EPOCH"], "Epoch", "The instant these elements are valid for."],
  [["MEAN_MOTION", "MEAN_MOTION_REV_PER_DAY"], "Mean motion", "Orbits per day."],
  [["ECCENTRICITY"], "Eccentricity", "Orbit shape: 0 = circle, near 1 = highly elongated."],
  [["INCLINATION", "INCLINATION_DEG"], "Inclination", "Tilt of the orbital plane vs the equator, in degrees."],
  [["RA_OF_ASC_NODE", "RA_OF_ASCENDING_NODE", "RA_OF_ASC_NODE_DEG"], "Right ascension of ascending node", "Where the orbit crosses the equator heading north, in degrees."],
  [["ARG_OF_PERICENTER", "ARG_OF_PERICENTER_DEG"], "Argument of pericenter", "Orientation of the orbit's closest point, in degrees."],
  [["MEAN_ANOMALY", "MEAN_ANOMALY_DEG"], "Mean anomaly", "Position along the orbit at epoch, in degrees."],
  [["REV_AT_EPOCH", "REV_AT_EPOCH"], "Revolution number at epoch"],
  [["BSTAR", "BSTAR_DRAG"], "B* drag term", "Atmospheric drag coefficient used by SGP4."],
  [["SEMIMAJOR_AXIS", "AOP", "APOAPSIS", "PERIAPSIS"], ""]
];

type OmmRecord = Record<string, unknown>;

function formatOmmValue(key: string, raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") {
    return "—";
  }
  if (key === "EPOCH" && typeof raw === "string") {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? String(raw) : `${formatTimestampCompact(date)} (${formatRelativeAge(date)})`;
  }
  if (typeof raw === "number") {
    if (key === "ECCENTRICITY") {
      return raw.toFixed(6);
    }
    if (key.endsWith("_DEG") || key === "INCLINATION" || key === "RA_OF_ASC_NODE" || key === "ARG_OF_PERICENTER" || key === "MEAN_ANOMALY") {
      return `${raw.toFixed(4)}°`;
    }
    if (key === "MEAN_MOTION" || key === "MEAN_MOTION_REV_PER_DAY") {
      return raw.toFixed(4);
    }
    if (Number.isInteger(raw)) {
      return String(raw);
    }
    return raw.toPrecision(6);
  }
  return String(raw);
}

function humanizedOmmFields(omm: OmmRecord): Array<[string, string, string?]> {
  const rows: Array<[string, string, string?]> = [];
  const used = new Set<string>();
  for (const [keys, label, tip] of OMM_FIELD_META) {
    if (!label) {
      continue;
    }
    const key = keys.find((candidate) => Object.prototype.hasOwnProperty.call(omm, candidate));
    if (!key) {
      continue;
    }
    used.add(key);
    rows.push([label, formatOmmValue(key, omm[key]), tip]);
  }
  // Surface any extra keys the schema didn't anticipate so no data is hidden.
  for (const key of Object.keys(omm)) {
    if (used.has(key)) {
      continue;
    }
    rows.push([key.replace(/_/g, " ").toLowerCase(), formatOmmValue(key, omm[key])]);
  }
  return rows;
}

export function DetailsPage() {
  const {
    selectedSatellite,
    satellites,
    observer,
    refreshingSelected,
    refreshSelectedSatellite,
    selectSatellite,
    setPage
  } = useApp();
  const now = useTicker(1000);

  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);
  const [refreshIsError, setRefreshIsError] = useState(false);
  const [showRawElements, setShowRawElements] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const copyElements = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy failed");
    }
    window.setTimeout(() => setCopyStatus(null), 1800);
  };

  const handleRefreshTle = async () => {
    setRefreshStatus(null);
    try {
      await refreshSelectedSatellite();
      setRefreshIsError(false);
      setRefreshStatus("TLE refreshed.");
    } catch (caught) {
      setRefreshIsError(true);
      setRefreshStatus(caught instanceof Error ? caught.message : "Refresh failed.");
    }
  };

  const snapshot = useMemo(() => {
    if (!selectedSatellite) {
      return null;
    }

    // Bad or decayed elements should degrade gracefully instead of crashing the page.
    try {
      return computeOrbitSnapshot(selectedSatellite, now, observer);
    } catch {
      return null;
    }
  }, [now, observer, selectedSatellite]);

  const metrics = useMemo(() => {
    if (!selectedSatellite) {
      return null;
    }

    try {
      return getOrbitMetrics(selectedSatellite);
    } catch {
      return null;
    }
  }, [selectedSatellite]);


  const epochAge = selectedSatellite ? epochAgeDays(selectedSatellite.epoch, now) : undefined;

  if (!selectedSatellite || !snapshot || !metrics) {
    return (
      <div className="panel p-8">
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-[var(--text)]">Satellite details</h1>
        {selectedSatellite ? (
          <>
            <p className="mt-2 text-[var(--muted)]">
              Could not propagate {selectedSatellite.name}. Its orbital elements may be stale or the object may have
              decayed.
            </p>
            <Button
              className="mt-4"
              disabled={refreshingSelected}
              onClick={() => void handleRefreshTle()}
              title="Fetch fresh two-line elements (TLE) for this satellite"
            >
              {refreshingSelected ? "Refreshing…" : "Update orbit data"}
            </Button>
            {refreshStatus ? (
              <p className={`mono mt-3 text-sm ${refreshIsError ? "text-[var(--danger)]" : "text-[var(--accent)]"}`}>
                {refreshStatus}
              </p>
            ) : null}
          </>
        ) : satellites.length === 0 ? (
          <>
            <p className="mt-2 text-[var(--muted)]">The catalog is empty, so there is nothing to inspect yet.</p>
            <Button className="mt-4" onClick={() => setPage("catalog")}>
              Add a satellite
            </Button>
          </>
        ) : (
          <>
            <p className="mt-2 text-[var(--muted)]">Select a satellite to inspect its orbital elements.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <select
                aria-label="Select a satellite"
                className="max-w-xs"
                defaultValue=""
                onChange={(event) => {
                  if (event.target.value) {
                    selectSatellite(event.target.value);
                  }
                }}
              >
                <option value="" disabled>
                  Pick a satellite…
                </option>
                {satellites.map((satellite) => (
                  <option key={satellite.id} value={satellite.id}>
                    {satellite.name}
                  </option>
                ))}
              </select>
              <Button variant="secondary" onClick={() => setPage("catalog")}>
                Open Catalog
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <section className="panel min-w-0 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="label">Object details</p>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-[var(--text)]">{selectedSatellite.name}</h1>
            <p className="mono mt-1.5 text-sm text-[var(--muted)]">
              NORAD ID {selectedSatellite.noradId}
              {selectedSatellite.internationalDesignator ? ` · ${selectedSatellite.internationalDesignator}` : ""}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
              <TleFreshnessBadge satellite={selectedSatellite} />
              <span className="mono">
                Epoch {epochAge === undefined ? "unknown" : `${Math.max(0, epochAge).toFixed(1)}d old`}
              </span>
              <span className="text-[var(--faint)]">·</span>
              <span className="mono">Fetched {formatRelativeAge(selectedSatellite.fetchedAt, now)}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              disabled={refreshingSelected}
              onClick={() => void handleRefreshTle()}
              title="Fetch fresh two-line elements (TLE) for this satellite"
            >
              {refreshingSelected ? "Refreshing…" : "Update orbit data"}
            </Button>
            {refreshStatus ? (
              <p className={`mono text-sm ${refreshIsError ? "text-[var(--danger)]" : "text-[var(--accent)]"}`}>
                {refreshStatus}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
          {[
            ["Inclination", `${metrics.inclinationDeg.toFixed(2)}°`],
            ["Period", `${metrics.periodMin.toFixed(1)} min`],
            ["Eccentricity", metrics.eccentricity.toFixed(6)],
            ["Apogee", `${metrics.apogeeKm.toFixed(1)} km`],
            ["Perigee", `${metrics.perigeeKm.toFixed(1)} km`],
            ["Look Elevation", `${snapshot.elevationDeg.toFixed(1)}°`],
            ["Look Azimuth", `${snapshot.azimuthDeg.toFixed(1)}°`],
            ["Range", `${snapshot.rangeKm.toFixed(1)} km`]
          ].map(([label, value]) => (
            <div key={label} className="panel-strong p-3 sm:p-4">
              <div className="text-xs font-medium text-[var(--faint)]">{label}</div>
              <div className="mono mt-1.5 text-base text-[var(--text)] sm:text-xl">{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-6">
          <h2 className="text-base font-semibold text-[var(--text)]">Orbital elements</h2>
          {selectedSatellite.tle ? (
            <div className="mono mt-3 space-y-1 overflow-auto rounded-[10px] border border-[var(--line)] bg-[var(--bg)] p-4 text-xs text-[var(--muted)]">
              <p className="text-[var(--faint)]">Two-line element set (TLE)</p>
              <p className="whitespace-pre">{selectedSatellite.tle.line1}</p>
              <p className="whitespace-pre">{selectedSatellite.tle.line2}</p>
            </div>
          ) : (
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              {humanizedOmmFields((selectedSatellite.omm ?? {}) as OmmRecord).map(([label, value, tip]) => (
                <div key={label} className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] py-1.5">
                  <dt className="text-xs font-medium text-[var(--faint)]" title={tip}>
                    {label}
                  </dt>
                  <dd className="mono truncate text-sm text-[var(--text)]" title={value}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {/* With a TLE the two lines are already shown above, so offer to copy them
              instead of revealing an identical second copy. */}
          {selectedSatellite.tle ? (
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => void copyElements(`${selectedSatellite.tle!.line1}\n${selectedSatellite.tle!.line2}`)}
            >
              {copyStatus ?? "Copy TLE"}
            </Button>
          ) : (
            <>
              <button
                type="button"
                className="link-button mt-3 text-xs text-[var(--muted)] hover:text-[var(--text)]"
                aria-expanded={showRawElements}
                onClick={() => setShowRawElements((open) => !open)}
              >
                {showRawElements ? "Hide raw element data" : "Show raw element data"}
              </button>
              {showRawElements ? (
                <pre className="mono mt-2 max-h-72 overflow-auto rounded-[10px] border border-[var(--line)] bg-[var(--bg)] p-4 text-xs text-[var(--muted)]">
                  {JSON.stringify(selectedSatellite.omm, null, 2)}
                </pre>
              ) : null}
            </>
          )}
        </div>
      </section>

    </div>
  );
}
