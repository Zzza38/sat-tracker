import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyPass } from "../platform";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("web notifications", () => {
  it("uses a service worker when the Notification constructor is unavailable", async () => {
    const showNotification = vi.fn().mockResolvedValue(undefined);
    const IllegalNotification = Object.assign(
      vi.fn(() => { throw new TypeError("Illegal constructor"); }),
      { permission: "granted", requestPermission: vi.fn() }
    );
    vi.stubGlobal("Notification", IllegalNotification);
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: vi.fn().mockResolvedValue({ showNotification }) }
    });

    await expect(notifyPass("ISS", "Look up")).resolves.toBe(true);
    expect(showNotification).toHaveBeenCalledWith("ISS", { body: "Look up" });
    expect(IllegalNotification).not.toHaveBeenCalled();
  });
});
