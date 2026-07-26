import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
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

const APP_ICON_ASSET_URL = `${import.meta.env.BASE_URL}sat-tracker-icon.svg`;

export function ElectronTitlebar() {
  const { page, satellites, watchlistIds, selectedSatelliteId, selectSatellite } = useApp();
  const isElectron = isElectronRuntime();
  const platform = window.electronAPI?.platform;
  const [satelliteMenuOpen, setSatelliteMenuOpen] = useState(false);
  const satelliteMenuRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<{ pointerId: number } | null>(null);
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

  function isInteractiveDragTarget(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest("button, a, input, select, textarea, [role='button'], [data-window-no-drag]"));
  }

  function handleTitlebarPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || isInteractiveDragTarget(event.target)) {
      return;
    }

    draggingRef.current = { pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    void window.electronAPI?.windowDragStart({
      screenX: event.screenX,
      screenY: event.screenY
    });
  }

  function handleTitlebarPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (draggingRef.current?.pointerId !== event.pointerId) {
      return;
    }

    void window.electronAPI?.windowDragMove({
      screenX: event.screenX,
      screenY: event.screenY
    });
  }

  function handleTitlebarPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (draggingRef.current?.pointerId !== event.pointerId) {
      return;
    }

    draggingRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    void window.electronAPI?.windowDragEnd();
  }

  return (
    <div
      className="electron-titlebar"
      data-electron={isElectron ? "true" : "false"}
      data-platform={platform}
      onPointerDown={handleTitlebarPointerDown}
      onPointerMove={handleTitlebarPointerMove}
      onPointerUp={handleTitlebarPointerEnd}
      onPointerCancel={handleTitlebarPointerEnd}
    >
      <div className="electron-titlebar-brand">
        <img className="electron-titlebar-icon" src={APP_ICON_ASSET_URL} alt="" />
        <span className="electron-titlebar-name">Sat Tracker</span>
      </div>

      <div className="electron-titlebar-center">
        <span className="electron-titlebar-page">{pageLabels[page]}</span>
        <div ref={satelliteMenuRef} className="electron-titlebar-satellite" data-window-no-drag>
          <button
            type="button"
            className="electron-titlebar-satellite-trigger"
            onClick={() => setSatelliteMenuOpen((open) => !open)}
            aria-haspopup="menu"
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
            <div className="electron-titlebar-satellite-menu" role="menu" aria-label="Tracked satellites">
              {trackedSatellites.map((satellite) => {
                const selected = satellite.id === selectedSatelliteId;
                return (
                  <button
                    key={satellite.id}
                    type="button"
                    className="electron-titlebar-satellite-option"
                    role="menuitemradio"
                    aria-checked={selected}
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
