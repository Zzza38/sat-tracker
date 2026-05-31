export function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 3600000);
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86400000);
}

export function formatTimestamp(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
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

export function isStale(epoch?: string, fetchedAt?: string, maxAgeHours = 12) {
  const ageDays = epochAgeDays(epoch);
  if (ageDays !== undefined && ageDays > 3) {
    return true;
  }

  if (!fetchedAt) {
    return true;
  }

  const fetched = new Date(fetchedAt);
  const hoursSinceFetch = (Date.now() - fetched.getTime()) / 3600000;
  return hoursSinceFetch > maxAgeHours;
}
