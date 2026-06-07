import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Satellite } from "lucide-react";
import { useApp } from "../context/AppContext";
import { isElectronRuntime } from "../lib/platform";

const pageLabels = {
  catalog: "Catalog",
  tracker: "Tracker",
  passes: "Passes",
  details: "Details",
  settings: "Settings"
} as const;

export function ElectronTitlebar() {
  const { page, satellites, watchlistIds, selectedSatelliteId, selectSatellite } = useApp();
  const [satelliteMenuOpen, setSatelliteMenuOpen] = useState(false);
  const satelliteMenuRef = useRef<HTMLDivElement | null>(null);
  const trackedSatellites = useMemo(() => {
    const recordsById = new Map(satellites.map((satellite) => [satellite.id, satellite]));
    return watchlistIds.flatMap((id) => {
      const satellite = recordsById.get(id);
      return satellite ? [satellite] : [];
    });
  }, [satellites, watchlistIds]);
  const selectedTrackedSatellite = trackedSatellites.find((satellite) => satellite.id === selectedSatelliteId);

  useEffect(() => {
    if (!satelliteMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!satelliteMenuRef.current?.contains(event.target as Node)) {
        setSatelliteMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSatelliteMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [satelliteMenuOpen]);

  if (!isElectronRuntime()) {
    return null;
  }

  return (
    <div className="electron-titlebar">
      <div className="electron-titlebar-brand">
        <img className="electron-titlebar-icon" src="/sat-tracker-icon.svg" alt="" />
        <span className="electron-titlebar-name">Sat Tracker</span>
      </div>

      <div className="electron-titlebar-center">
        <span className="electron-titlebar-page">{pageLabels[page]}</span>
        <div ref={satelliteMenuRef} className="electron-titlebar-satellite">
          <button
            type="button"
            className="electron-titlebar-satellite-trigger"
            onClick={() => setSatelliteMenuOpen((open) => !open)}
            aria-haspopup="listbox"
            aria-expanded={satelliteMenuOpen}
            disabled={trackedSatellites.length === 0}
          >
            <span className="electron-titlebar-satellite-icon">
              <Satellite size={13} aria-hidden="true" />
            </span>
            <span className="electron-titlebar-satellite-name">
              {selectedTrackedSatellite?.name ?? (trackedSatellites.length > 0 ? "Choose satellite" : "No tracked satellites")}
            </span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          {satelliteMenuOpen && trackedSatellites.length > 0 ? (
            <div className="electron-titlebar-satellite-menu" role="listbox" aria-label="Tracked satellites">
              {trackedSatellites.map((satellite) => {
                const selected = satellite.id === selectedSatelliteId;
                return (
                  <button
                    key={satellite.id}
                    type="button"
                    className="electron-titlebar-satellite-option"
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      selectSatellite(satellite.id);
                      setSatelliteMenuOpen(false);
                    }}
                  >
                    <span>{satellite.name}</span>
                    {selected ? <Check size={13} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
