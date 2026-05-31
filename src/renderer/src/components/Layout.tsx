import { ReactNode } from "react";
import { ElectronTitlebar } from "./ElectronTitlebar";
import { NavRail } from "./NavRail";
import { isElectronRuntime } from "../lib/platform";

export function Layout({ children }: { children: ReactNode }) {
  const isElectron = isElectronRuntime();

  return (
    <div className={`min-h-screen${isElectron ? " electron-shell" : ""}`}>
      <ElectronTitlebar />
      <div className="mx-auto flex min-h-screen max-w-[1600px] gap-6 p-4 md:p-6">
        <NavRail />
        <main className="min-w-0 flex-1 py-1">{children}</main>
      </div>
    </div>
  );
}
