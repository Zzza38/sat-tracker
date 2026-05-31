import { predictPassesForSatellite } from "@/shared/passes/predictor-core";
import { useMemo } from "react";
import { computeOrbitSnapshot, getOrbitMetrics } from "@/shared/propagation/engine";
import { formatTimestamp } from "@/shared/utils/date";
import { useApp } from "../context/AppContext";
import { useTicker } from "../hooks/useTicker";
import { Button } from "../components/ui/button";

export function DetailsPage() {
  const {
    selectedSatellite,
    observer,
    refreshSelectedSatellite
  } = useApp();
  const now = useTicker(1000);

  const snapshot = useMemo(() => {
    if (!selectedSatellite) {
      return null;
    }

    return computeOrbitSnapshot(selectedSatellite, now, observer);
  }, [now, observer, selectedSatellite]);

  const metrics = useMemo(() => {
    if (!selectedSatellite) {
      return null;
    }

    return getOrbitMetrics(selectedSatellite);
  }, [selectedSatellite]);

  const upcoming = useMemo(() => {
    if (!selectedSatellite) {
      return [];
    }

    return predictPassesForSatellite(selectedSatellite, observer, {
      start: new Date(),
      end: new Date(Date.now() + 3 * 86400000)
    }).slice(0, 5);
  }, [observer, selectedSatellite]);

  if (!selectedSatellite || !snapshot || !metrics) {
    return (
      <div className="panel p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">Satellite details</h1>
        <p className="mt-2 text-[var(--muted)]">Select a satellite to inspect orbital elements and upcoming passes.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="label">Object details</p>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--text)]">{selectedSatellite.name}</h1>
            <p className="mono mt-1.5 text-sm text-[var(--muted)]">
              NORAD ID {selectedSatellite.noradId}
              {selectedSatellite.internationalDesignator ? ` · ${selectedSatellite.internationalDesignator}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button onClick={() => void refreshSelectedSatellite()}>Refresh TLE</Button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
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
            <div key={label} className="panel-strong p-4">
              <div className="text-xs font-medium text-[var(--faint)]">{label}</div>
              <div className="mono mt-1.5 text-lg text-[var(--text)]">{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-6">
          <h2 className="text-base font-semibold text-[var(--text)]">Orbital elements</h2>
          <pre className="mono mt-3 overflow-auto rounded-[10px] border border-[var(--line)] bg-[var(--bg)] p-4 text-xs text-[var(--muted)]">
            {selectedSatellite.tle
              ? `${selectedSatellite.tle.line1}\n${selectedSatellite.tle.line2}`
              : JSON.stringify(selectedSatellite.omm, null, 2)}
          </pre>
        </div>
      </section>

      <section className="panel p-5">
        <p className="label">Upcoming passes</p>
        <div className="mt-4 space-y-3">
          {upcoming.map((pass) => (
            <div key={pass.aos} className="panel-strong p-4">
              <div className="font-semibold text-[var(--text)]">{formatTimestamp(pass.aos)}</div>
              <div className="mono mt-1.5 text-sm text-[var(--muted)]">
                Max {pass.maxElevationDeg.toFixed(1)}° · AOS az {pass.aosAzimuthDeg.toFixed(0)}° · LOS az{" "}
                {pass.losAzimuthDeg.toFixed(0)}°
              </div>
            </div>
          ))}
          {upcoming.length === 0 ? <p className="text-[var(--muted)]">No passes above the current horizon mask.</p> : null}
        </div>
      </section>
    </div>
  );
}
