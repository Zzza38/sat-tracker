import { useEffect } from "react";
import { formatTimestamp } from "@/shared/utils/date";
import { notifyPass } from "../lib/platform";
import { readPassReminders, removePassReminder } from "../lib/passReminders";

export function PassReminderService() {
  useEffect(() => {
    const handled = new Set<string>();
    async function checkReminders() {
      const now = Date.now();
      const due = readPassReminders().filter(
        (reminder) => new Date(reminder.notifyAt).getTime() <= now
      );

      for (const reminder of due.filter((entry) => !handled.has(entry.id))) {
        handled.add(reminder.id);
        const aos = new Date(reminder.aos).getTime();
        if (aos >= now - 5 * 60_000) {
          try {
            await notifyPass(
              `${reminder.satelliteName} is coming up`,
              `Look for it at ${formatTimestamp(reminder.aos)}. Peak elevation ${reminder.maxElevationDeg.toFixed(0)}°.`
            );
          } catch {
            // A platform notification failure must not block later reminders
            // or retry this one every 15 seconds forever.
          }
        }
        removePassReminder(reminder.id);
      }
    }

    void checkReminders();
    const interval = window.setInterval(() => void checkReminders(), 15_000);
    return () => window.clearInterval(interval);
  }, []);

  return null;
}
