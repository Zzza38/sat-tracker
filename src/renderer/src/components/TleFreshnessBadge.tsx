import { epochAgeDays, formatFetchTooltip, formatRelativeAge } from "@/shared/utils/date";
import type { SatelliteRecord } from "@/shared/types";

function formatEpochAge(days: number) {
  if (days < 1) {
    return "<1d";
  }

  if (days < 10) {
    return `${days.toFixed(1)}d`;
  }

  return `${Math.round(days)}d`;
}

function freshnessForEpoch(epoch?: string) {
  const ageDays = epochAgeDays(epoch);
  if (ageDays === undefined) {
    return {
      label: "Epoch unknown",
      className: "badge",
      detail: "Epoch time is missing or invalid."
    };
  }

  const age = Math.max(0, ageDays);
  if (age <= 3) {
    return {
      label: `Fresh ${formatEpochAge(age)}`,
      className: "badge live",
      detail: `Epoch ${formatRelativeAge(epoch!)}.`
    };
  }

  if (age <= 7) {
    return {
      label: `Aging ${formatEpochAge(age)}`,
      className: "badge warning",
      detail: `Epoch ${formatRelativeAge(epoch!)}.`
    };
  }

  return {
    label: `Stale ${formatEpochAge(age)}`,
    className: "badge stale",
    detail: `Epoch ${formatRelativeAge(epoch!)}.`
  };
}

interface TleFreshnessBadgeProps {
  satellite: SatelliteRecord;
}

export function TleFreshnessBadge({ satellite }: TleFreshnessBadgeProps) {
  const freshness = freshnessForEpoch(satellite.epoch);
  const title = [
    freshness.detail,
    satellite.epoch ? `Epoch: ${new Date(satellite.epoch).toLocaleString()}` : null,
    formatFetchTooltip(satellite.fetchedAt)
  ].filter(Boolean).join(" ");

  return (
    <span className={freshness.className} title={title}>
      {freshness.label}
    </span>
  );
}
