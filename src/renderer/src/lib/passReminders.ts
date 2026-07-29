import type { PassPrediction } from "@/shared/types";

export interface PassReminder {
  id: string;
  satelliteId: string;
  satelliteName: string;
  aos: string;
  maxElevationDeg: number;
  notifyAt: string;
}

const STORAGE_KEY = "sat-tracker-pass-reminders";
export const REMINDERS_CHANGED_EVENT = "sat-tracker-reminders-changed";
export const DEFAULT_REMINDER_LEAD_MINUTES = 10;

export function passReminderId(pass: Pick<PassPrediction, "satelliteId" | "aos">) {
  const aosMinute = Math.round(new Date(pass.aos).getTime() / 60_000);
  return `${pass.satelliteId}:${aosMinute}`;
}

export function readPassReminders(): PassReminder[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as PassReminder[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePassReminders(reminders: PassReminder[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reminders));
  window.dispatchEvent(new Event(REMINDERS_CHANGED_EVENT));
}

export function hasPassReminder(pass: Pick<PassPrediction, "satelliteId" | "aos">) {
  const id = passReminderId(pass);
  return readPassReminders().some((reminder) => passReminderId(reminder) === id);
}

export function togglePassReminder(pass: PassPrediction, leadMinutes = DEFAULT_REMINDER_LEAD_MINUTES) {
  const reminders = readPassReminders();
  const id = passReminderId(pass);
  const exists = reminders.some((reminder) => passReminderId(reminder) === id);

  if (exists) {
    writePassReminders(reminders.filter((reminder) => passReminderId(reminder) !== id));
    return false;
  }

  const notifyAt = new Date(
    Math.max(Date.now(), new Date(pass.aos).getTime() - leadMinutes * 60_000)
  ).toISOString();
  writePassReminders([
    ...reminders,
    {
      id,
      satelliteId: pass.satelliteId,
      satelliteName: pass.satelliteName,
      aos: pass.aos,
      maxElevationDeg: pass.maxElevationDeg,
      notifyAt
    }
  ]);
  return true;
}

export function removePassReminder(id: string) {
  writePassReminders(readPassReminders().filter((reminder) => reminder.id !== id));
}
