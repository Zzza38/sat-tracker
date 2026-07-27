import { clsx } from "clsx";
import { useApp } from "../context/AppContext";
import { NAV_ITEMS } from "./navItems";

export function NavRail() {
  const { page, setPage } = useApp();

  return (
    <aside className="flex w-52 shrink-0 flex-col gap-1">
      <nav className="flex flex-col gap-1" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = page === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={clsx("nav-item", active && "active")}
              aria-current={active ? "page" : undefined}
              onClick={() => setPage(item.id)}
            >
              <Icon size={17} style={active ? { color: "var(--accent)" } : undefined} />
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
