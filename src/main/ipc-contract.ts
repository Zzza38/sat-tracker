export const MAX_SAVE_FILE_CONTENT_LENGTH = 10_000_000;

function isSafeDefaultFileName(value: string) {
  const windowsReservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  return (
    value.length > 0 &&
    value.length <= 255 &&
    !/[<>:"/\\|?*]/.test(value) &&
    !Array.from(value).some((character) => character.charCodeAt(0) < 32) &&
    !/[. ]$/.test(value) &&
    !windowsReservedName.test(value)
  );
}

export function isWindowControlAction(value: unknown): value is "minimize" | "maximize" | "close" {
  return value === "minimize" || value === "maximize" || value === "close";
}

export function isValidWindowDragPoint(value: unknown): value is { screenX: number; screenY: number } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const point = value as { screenX?: unknown; screenY?: unknown };
  return (
    typeof point.screenX === "number" &&
    typeof point.screenY === "number" &&
    Number.isFinite(point.screenX) &&
    Number.isFinite(point.screenY)
  );
}

export function isValidSaveFileRequest(content: unknown, defaultName: unknown) {
  return (
    typeof content === "string" &&
    content.length <= MAX_SAVE_FILE_CONTENT_LENGTH &&
    typeof defaultName === "string" &&
    isSafeDefaultFileName(defaultName)
  );
}

export function isValidNotificationRequest(title: unknown, body: unknown) {
  return (
    typeof title === "string" &&
    typeof body === "string" &&
    title.length <= 200 &&
    body.length <= 2000
  );
}
