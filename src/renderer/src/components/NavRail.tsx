import { clsx } from "clsx";
import { Globe2, Orbit, Radar, Settings2, TableProperties } from "lucide-react";
import { useApp } from "../context/AppContext";

const items = [
  { id: "catalog", label: "Catalog", icon: TableProperties },
  { id: "tracker", label: "Tracker", icon: Globe2 },
  { id: "passes", label: "Passes", icon: Radar },
  { id: "details", label: "Details", icon: Orbit },
  { id: "settings", label: "Settings", icon: Settings2 }
] as const;

export function NavRail() {
  const { page, setPage } = useApp();

  return (
    <aside className="flex w-52 shrink-0 flex-col gap-1">
      <div className="mb-5 flex items-center gap-2.5 px-3 pt-1">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)]">
          <Orbit size={18} className="text-white" />
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight text-[var(--text)]">Sat Tracker</div>
          <div className="text-xs leading-tight text-[var(--faint)]">Orbital ops</div>
        </div>
      </div>
      {items.map((item) => {
        const Icon = item.icon;
        const active = page === item.id;
        return (
          <button
            key={item.id}
            className={clsx("nav-item", active && "active")}
            onClick={() => setPage(item.id)}
          >
            <Icon size={17} style={active ? { color: "var(--accent)" } : undefined} />
            {item.label}
          </button>
        );
      })}
    </aside>
  );
}
