import { Globe2, Info, Radar, Settings2, TableProperties } from "lucide-react";

export const NAV_ITEMS = [
  { id: "catalog", label: "Catalog", icon: TableProperties },
  { id: "tracker", label: "Tracker", icon: Globe2 },
  { id: "passes", label: "Passes", icon: Radar },
  { id: "details", label: "Details", icon: Info },
  { id: "settings", label: "Settings", icon: Settings2 }
] as const;
