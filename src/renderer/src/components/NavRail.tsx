import { clsx } from "clsx";
import { Globe2, Info, Radar, Settings2, TableProperties } from "lucide-react";
import { useApp } from "../context/AppContext";

const items = [
  { id: "catalog", label: "Catalog", icon: TableProperties },
  { id: "tracker", label: "Tracker", icon: Globe2 },
  { id: "passes", label: "Passes", icon: Radar },
  { id: "details", label: "Details", icon: Info },
  { id: "settings", label: "Settings", icon: Settings2 }
] as const;

interface NavRailProps {
  onNavigate?: () => void;
}

export function NavRail({ onNavigate }: NavRailProps) {
  const { page, setPage } = useApp();

  return (
    <aside className="flex w-52 shrink-0 flex-col gap-1">
      {items.map((item) => {
        const Icon = item.icon;
        const active = page === item.id;
        return (
          <button
            key={item.id}
            type="button"
            className={clsx("nav-item", active && "active")}
            aria-current={active ? "page" : undefined}
            onClick={() => {
              setPage(item.id);
              onNavigate?.();
            }}
          >
            <Icon size={17} style={active ? { color: "var(--accent)" } : undefined} />
            {item.label}
          </button>
        );
      })}
    </aside>
  );
}
