import { describe, expect, it } from "vitest";
import {
  isValidNotificationRequest,
  isValidSaveFileRequest,
  isWindowControlAction,
  MAX_SAVE_FILE_CONTENT_LENGTH
} from "../ipc-contract";

describe("IPC contract", () => {
  it("accepts only known window-control actions", () => {
    expect(isWindowControlAction("close")).toBe(true);
    expect(isWindowControlAction("future-action")).toBe(false);
    expect(isWindowControlAction(null)).toBe(false);
  });

  it("bounds save-file payloads and names", () => {
    expect(isValidSaveFileRequest("content", "passes.csv")).toBe(true);
    expect(isValidSaveFileRequest("x".repeat(MAX_SAVE_FILE_CONTENT_LENGTH + 1), "passes.csv")).toBe(false);
    expect(isValidSaveFileRequest("content", "../".repeat(100))).toBe(false);
  });

  it("bounds notification fields", () => {
    expect(isValidNotificationRequest("Pass", "Starting soon")).toBe(true);
    expect(isValidNotificationRequest("x".repeat(201), "Starting soon")).toBe(false);
  });
});
