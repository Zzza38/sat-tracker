import { isElectronRuntime } from "../lib/platform";

const controls = [
  { action: "minimize", label: "Minimize" },
  { action: "maximize", label: "Maximize" },
  { action: "close", label: "Close" }
] as const;

export function ElectronTitlebar() {
  if (!isElectronRuntime()) {
    return null;
  }

  return (
    <div className="electron-titlebar" aria-hidden={false}>
      <div className="electron-titlebar-drag" />
      <div className="electron-window-controls">
        {controls.map((control) => (
          <button
            key={control.action}
            type="button"
            className={`electron-window-control electron-window-control-${control.action}`}
            aria-label={control.label}
            title={control.label}
            onClick={() => void window.electronAPI?.windowControl(control.action)}
          >
            <span />
          </button>
        ))}
      </div>
    </div>
  );
}
