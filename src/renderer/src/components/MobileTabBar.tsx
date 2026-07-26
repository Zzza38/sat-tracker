import { clsx } from "clsx";
import { useApp } from "../context/AppContext";
import { NAV_ITEMS } from "./navItems";

export function MobileTabBar() {
  const { page, setPage } = useApp();

  return (
    <nav className="mobile-tab-bar" aria-label="Primary">
      {NAV_ITEMS.map((item) => {
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
