import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "../hooks/useOnlineStatus";

export function OfflineBanner() {
  const online = useOnlineStatus();

  if (online) {
    return null;
  }

  return (
    <div
      className="mb-4 flex items-start gap-3 rounded-[10px] border border-[var(--line-strong)] bg-[var(--surface)] px-4 py-3 text-sm text-[var(--text)]"
      role="status"
    >
      <WifiOff size={16} className="mt-0.5 shrink-0 text-[var(--warning)]" aria-hidden="true" />
      <div>
        <p className="font-medium text-[var(--text)]">Offline mode</p>
        <p className="mt-1 text-[var(--muted)]">
          Tracking uses saved orbit data. Catalog refresh and NORAD lookups need a connection; manual
          TLE paste still works.
        </p>
      </div>
    </div>
  );
}
