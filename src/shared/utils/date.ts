export function formatTimestamp(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short"
  });
}

// Compact, single-line form for dense tables/lists: no comma, no seconds, no
// embedded zone (the zone is shown once per view via timeZoneAbbreviation).
export function formatTimestampCompact(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date
    .toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    })
    .replace(",", "");
}

export function timeZoneAbbreviation(reference = new Date()) {
  const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(reference);
  return parts.find((part) => part.type === "timeZoneName")?.value ?? "local time";
}

// Date and time halves (no zone) for two-line table cells, so wide datetime
// columns never force horizontal scroll or clip sibling columns.
export function formatDateTimeParts(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const datePart = date
    .toLocaleDateString(undefined, { month: "short", day: "numeric" })
    .replace(",", "");
  const timePart = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return { datePart, timePart };
}

export function formatDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return `${minutes}m ${remainder}s`;
}

export function formatRelativeAge(value: string | Date, reference = new Date()) {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  const seconds = Math.max(0, Math.floor((reference.getTime() - date.getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 14) {
    return `${days}d ago`;
  }

  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

export function formatFetchTooltip(fetchedAt?: string) {
  if (!fetchedAt) {
    return "Fetch time unknown";
  }

  const fetched = new Date(fetchedAt);
  if (Number.isNaN(fetched.getTime())) {
    return "Fetch time unknown";
  }

  return `Fetched ${formatTimestamp(fetched)} (${formatRelativeAge(fetched)})`;
}

export function epochAgeDays(epoch?: string, reference = new Date()) {
  if (!epoch) {
    return undefined;
  }

  const epochDate = new Date(epoch);
  if (Number.isNaN(epochDate.getTime())) {
    return undefined;
  }

  return (reference.getTime() - epochDate.getTime()) / 86400000;
}
