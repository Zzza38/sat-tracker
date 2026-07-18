import { ReactNode } from "react";
import { ElectronTitlebar } from "./ElectronTitlebar";
import { NavRail } from "./NavRail";
import { MobileTabBar } from "./MobileTabBar";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell min-h-screen">
      <ElectronTitlebar />
      <div className="app-content mx-auto flex min-h-screen max-w-[1600px] gap-6 p-3 sm:p-4 md:p-6">
        <div className="desktop-nav">
          <NavRail />
        </div>

        <main className="main-shell min-w-0 flex-1">{children}</main>
      </div>
      <MobileTabBar />
    </div>
  );
}
