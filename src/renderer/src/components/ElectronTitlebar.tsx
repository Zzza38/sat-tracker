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
  const { page, satellites, watchlistIds, selectedSatelliteId, selectedSatellite, selectSatellite } = useApp();
  const isElectron = isElectronRuntime();
  const platform =
    window.electronAPI?.platform ??
    (/Mac/.test(navigator.userAgent) ? "darwin" : navigator.userAgent.includes("Win") ? "win32" : "linux");
  const [satelliteMenuOpen, setSatelliteMenuOpen] = useState(false);
  const satelliteMenuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const draggingRef = useRef<{ pointerId: number } | null>(null);
  const trackedSatellites = useMemo(() => {
    const recordsById = new Map(satellites.map((satellite) => [satellite.id, satellite]));
    return watchlistIds.flatMap((id) => {
      const satellite = recordsById.get(id);
      return satellite ? [satellite] : [];
    });
  }, [satellites, watchlistIds]);
  const menuSatellites = useMemo(
    () =>
      selectedSatellite && !watchlistIds.includes(selectedSatellite.id)
        ? [selectedSatellite, ...trackedSatellites]
        : trackedSatellites,
    [selectedSatellite, trackedSatellites, watchlistIds]
  );

  function closeMenu() {
    setSatelliteMenuOpen(false);
    triggerRef.current?.focus();
  }

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
        closeMenu();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [satelliteMenuOpen]);

  useEffect(() => {
    if (!satelliteMenuOpen) {
      return;
    }

    const menu = satelliteMenuRef.current;
    if (!menu) {
      return;
    }
    const options = menu.querySelectorAll<HTMLElement>('[role="option"]');
    if (options.length === 0) {
      return;
    }
    const target = menu.querySelector<HTMLElement>('[role="option"][aria-selected="true"]') ?? options[0];
    target.focus();
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
      data-platform={isElectron ? platform : "web"}
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
            ref={triggerRef}
            type="button"
            className="electron-titlebar-satellite-trigger"
            onClick={() => setSatelliteMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={satelliteMenuOpen}
            disabled={menuSatellites.length === 0}
          >
            <span className="electron-titlebar-satellite-icon">
              <Satellite size={13} aria-hidden="true" />
            </span>
            <span className="electron-titlebar-satellite-name">
              {selectedSatellite?.name ?? (menuSatellites.length > 0 ? "Choose satellite" : "No satellites")}
            </span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          {satelliteMenuOpen && menuSatellites.length > 0 ? (
            <div
              className="electron-titlebar-satellite-menu"
              role="listbox"
              aria-label="Satellites"
              onKeyDown={(event) => {
                const menu = satelliteMenuRef.current;
                if (!menu) {
                  return;
                }
                const options = Array.from(menu.querySelectorAll<HTMLElement>('[role="option"]'));
                const index = options.indexOf(document.activeElement as HTMLElement);
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const next =
                    event.key === "ArrowDown"
                      ? (index + 1) % options.length
                      : (index - 1 + options.length) % options.length;
                  options[next]?.focus();
                } else if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  (event.key === "Home" ? options[0] : options[options.length - 1])?.focus();
                }
              }}
            >
              {menuSatellites.map((satellite) => {
                const selected = satellite.id === selectedSatelliteId;
                const tracked = watchlistIds.includes(satellite.id);
                return (
                  <button
                    key={satellite.id}
                    type="button"
                    className="electron-titlebar-satellite-option"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => {
                      selectSatellite(satellite.id);
                      closeMenu();
                    }}
                  >
                    <span>{satellite.name}</span>
                    {!tracked ? <span className="electron-titlebar-satellite-untracked">not tracked</span> : null}
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
