import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCelestrakSatellite, fetchTleSource } from "@/shared/celestrak/client";
import { ISS_OMM } from "@/shared/__tests__/fixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CelesTrak client", () => {
  it("reports invalid JSON responses clearly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html>upstream error</html>", {
          status: 200,
          headers: { "content-type": "text/html" }
        })
      )
    );

    await expect(fetchCelestrakSatellite("25544")).rejects.toThrow(/invalid OMM JSON/);
  });

  it("blocks custom sources on private-network addresses", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchTleSource({
        id: "private",
        name: "Private",
        endpoint: "url",
        url: "http://127.0.0.1/catalog.json"
      })
    ).rejects.toThrow(/local or private-network/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("streams JSON source records", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify([ISS_OMM, { ...ISS_OMM, NORAD_CAT_ID: 25545 }]), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    );

    const records = await fetchTleSource({
      id: "public",
      name: "Public",
      endpoint: "url",
      url: "https://example.com/catalog.json"
    });

    expect(records.map((record) => record.id)).toEqual(["25544", "25545"]);
  });
});
