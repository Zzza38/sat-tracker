import { useEffect, useMemo, useState } from "react";
import {
  computeDopplerFrequency,
  downlinkHzToMhzInput,
  formatDopplerShift,
  formatDopplerShiftLabel,
  formatFrequencyMhz,
  parseDownlinkMhzInput
} from "@/shared/propagation/engine";

interface DopplerPanelProps {
  dopplerFactor: number;
  downlinkHz?: number;
  onDownlinkHzChange?: (downlinkHz: number | undefined) => void;
}

export function DopplerPanel({ dopplerFactor, downlinkHz, onDownlinkHzChange }: DopplerPanelProps) {
  const [downlinkInput, setDownlinkInput] = useState(() => downlinkHzToMhzInput(downlinkHz));

  useEffect(() => {
    setDownlinkInput(downlinkHzToMhzInput(downlinkHz));
  }, [downlinkHz]);

  const nominalHz = useMemo(() => parseDownlinkMhzInput(downlinkInput), [downlinkInput]);
  const shiftHz = nominalHz ? formatDopplerShift(dopplerFactor, nominalHz) : undefined;
  const receivedHz = nominalHz ? computeDopplerFrequency(nominalHz, dopplerFactor) : undefined;

  function commitDownlink() {
    onDownlinkHzChange?.(nominalHz);
  }

  return (
    <div className="panel-strong p-4">
      <div className="text-xs font-medium text-[var(--faint)]">Downlink Doppler</div>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Enter the published downlink and see the frequency you would actually receive right now.
      </p>

      <label className="mt-4 block space-y-1.5">
        <span className="text-xs font-medium text-[var(--faint)]">Nominal downlink (MHz)</span>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            className="mono"
            inputMode="decimal"
            placeholder="437.500"
            value={downlinkInput}
            onChange={(event) => setDownlinkInput(event.target.value)}
            onBlur={commitDownlink}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitDownlink();
              }
            }}
          />
          <span className="flex items-center px-1 text-xs font-medium text-[var(--muted)]">MHz</span>
        </div>
      </label>

      {nominalHz && shiftHz !== undefined && receivedHz !== undefined ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <div className="text-xs font-medium text-[var(--faint)]">Received now</div>
            <div className="mono mt-1 text-lg text-[var(--text)]">{formatFrequencyMhz(receivedHz, 6)}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-[var(--faint)]">Doppler shift</div>
            <div className="mono mt-1 text-lg text-[var(--text)]">{formatDopplerShiftLabel(shiftHz)}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-[var(--faint)]">Doppler factor</div>
            <div className="mono mt-1 text-lg text-[var(--text)]">{dopplerFactor.toFixed(7)}</div>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-[var(--muted)]">Enter a valid downlink frequency to compute Doppler.</p>
      )}
    </div>
  );
}
