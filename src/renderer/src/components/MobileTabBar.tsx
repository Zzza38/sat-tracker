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

export function MobileTabBar() {
  const { page, setPage } = useApp();

  return (
    <nav className="mobile-tab-bar" aria-label="Primary">
      {items.map((item) => {
        const Icon = item.icon;
        const active = page === item.id;
        return (
          <button
            key={item.id}
            type="button"
            className={clsx("mobile-tab-item", active && "active")}
            aria-current={active ? "page" : undefined}
            onClick={() => setPage(item.id)}
          >
            <Icon size={20} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
