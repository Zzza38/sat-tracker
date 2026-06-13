import { ReactNode, useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { ElectronTitlebar } from "./ElectronTitlebar";
import { NavRail } from "./NavRail";

const COMPACT_NAV_QUERY = "(max-width: 767px) and (max-aspect-ratio: 4 / 3)";

export function Layout({ children }: { children: ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileNavRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const media = window.matchMedia(COMPACT_NAV_QUERY);
    const handleChange = () => {
      if (!media.matches) {
        setMobileNavOpen(false);
      }
    };

    handleChange();
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (!mobileNavOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    mobileNavRef.current?.querySelector<HTMLElement>("button")?.focus();

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileNavOpen(false);
        return;
      }
      if (event.key !== "Tab" || !mobileNavRef.current) {
        return;
      }

      const focusable = Array.from(
        mobileNavRef.current.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")
      ).filter((element) => !element.hasAttribute("disabled"));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [mobileNavOpen]);

  return (
    <div className="app-shell min-h-screen">
      <ElectronTitlebar />
      <div className="mx-auto flex min-h-screen max-w-[1600px] gap-6 p-3 sm:p-4 md:p-6">
        <div className="desktop-nav">
          <NavRail />
        </div>

        <button
          type="button"
          className="mobile-menu-button"
          aria-label="Open navigation"
          aria-expanded={mobileNavOpen}
          onClick={() => setMobileNavOpen(true)}
        >
          <Menu size={18} />
        </button>

        {mobileNavOpen ? (
          <div className="mobile-nav-overlay fixed inset-0 z-[9000]">
            <button
              type="button"
              className="mobile-nav-backdrop"
              aria-label="Close navigation"
              onClick={() => setMobileNavOpen(false)}
            />
            <div
              ref={mobileNavRef}
              className="mobile-nav-panel absolute bottom-0 left-0 top-0 w-[min(82vw,280px)] border-r border-[var(--line-strong)] bg-[var(--bg)] p-4 pt-5 shadow-2xl"
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
            >
              <button
                type="button"
                className="mobile-menu-button mobile-menu-button-inline mobile-nav-close"
                aria-label="Close navigation"
                onClick={() => setMobileNavOpen(false)}
              >
                <X size={18} />
              </button>
              <NavRail onNavigate={() => setMobileNavOpen(false)} />
            </div>
          </div>
        ) : null}

        <main className="main-shell min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
