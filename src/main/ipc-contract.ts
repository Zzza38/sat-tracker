export const MAX_SAVE_FILE_CONTENT_LENGTH = 10_000_000;

export function isWindowControlAction(value: unknown): value is "minimize" | "maximize" | "close" {
  return value === "minimize" || value === "maximize" || value === "close";
}

export function isValidSaveFileRequest(content: unknown, defaultName: unknown) {
  return (
    typeof content === "string" &&
    content.length <= MAX_SAVE_FILE_CONTENT_LENGTH &&
    typeof defaultName === "string" &&
    defaultName.length > 0 &&
    defaultName.length <= 255
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
