import { expect, test } from "@playwright/test";

test("production app loads and survives a service-worker-controlled offline reload", async ({ page, context }) => {
  await page.route("https://celestrak.org/**", (route) => route.abort());
  await page.goto("/");

  await expect(page).toHaveTitle("Sat Tracker");
  await expect(page.getByRole("heading", { name: "Satellite registry" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Tracker/ }).first()).toBeVisible();

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).toBeTruthy();
  const manifest = await page.evaluate(async (href) => (await fetch(href!)).json(), manifestHref);
  expect(manifest.start_url).toBe(".");
  expect(manifest.scope).toBe(".");

  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) {
    await page.reload();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  }

  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0
  });
  expect(await page.evaluate(() =>
    fetch("https://example.com/offline-probe", { cache: "no-store" }).then(
      () => "resolved",
      () => "rejected"
    )
  )).toBe("rejected");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Satellite registry" })).toBeVisible();
});
