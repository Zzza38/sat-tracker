import { Camera, Globe2, Info, Radar, Settings2, TableProperties } from "lucide-react";
import { canAccessOrientationSensors } from "../lib/arCapability";

export const NAV_ITEMS = [
  { id: "catalog", label: "Catalog", icon: TableProperties },
  { id: "tracker", label: "Tracker", icon: Globe2 },
  { id: "ar", label: "AR finder", icon: Camera },
  { id: "passes", label: "Passes", icon: Radar },
  { id: "details", label: "Details", icon: Info },
  { id: "settings", label: "Settings", icon: Settings2 }
] as const;

export function getVisibleNavItems(arAvailable = canAccessOrientationSensors()) {
  return NAV_ITEMS.filter((item) => item.id !== "ar" || arAvailable);
}
