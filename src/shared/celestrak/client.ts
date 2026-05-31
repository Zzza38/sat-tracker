import { createSatelliteRecord, parseElementInput } from "@/shared/tle/parser";
import { TleSource } from "@/shared/types";

const GP_ENDPOINT = "https://celestrak.org/NORAD/elements/gp.php";
const SUP_GP_ENDPOINT = "https://celestrak.org/NORAD/elements/supplemental/sup-gp.php";

export async function fetchCelestrakSatellite(noradId: string) {
  const ommUrl = new URL(GP_ENDPOINT);
  ommUrl.searchParams.set("CATNR", noradId);
  ommUrl.searchParams.set("FORMAT", "JSON");

  const ommResponse = await fetch(ommUrl);
  if (!ommResponse.ok) {
    throw new Error(`CelesTrak returned ${ommResponse.status} for NORAD ${noradId}.`);
  }

  const ommPayload = (await ommResponse.json()) as unknown[];
  const first = ommPayload[0];
  if (!first) {
    throw new Error(`No GP data found for NORAD ${noradId}.`);
  }

  return createSatelliteRecord(parseElementInput(JSON.stringify(first)), "celestrak");
}

export async function fetchTleSource(source: TleSource) {
  if (source.endpoint === "url") {
    if (!source.url?.trim()) {
      throw new Error(`Source "${source.name}" is missing a URL.`);
    }

    const response = await fetch(source.url.trim());
    if (!response.ok) {
      throw new Error(`Failed to fetch "${source.name}".`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    const raw = await response.text();
    if (contentType.includes("json") || raw.trim().startsWith("[")) {
      const payload = JSON.parse(raw) as unknown[];
      return payload.map((entry) => createSatelliteRecord(parseElementInput(JSON.stringify(entry)), "seed"));
    }

    if (raw.trim().startsWith("{")) {
      return [createSatelliteRecord(parseElementInput(raw), "seed")];
    }

    return parseTleCatalog(raw).map((entry) => createSatelliteRecord(parseElementInput(entry), "seed"));
  }

  if (source.endpoint === "supplemental") {
    if (!source.supplementalFile?.trim()) {
      throw new Error(`Source "${source.name}" is missing a supplemental file name.`);
    }

    const url = new URL(SUP_GP_ENDPOINT);
    url.searchParams.set("FILE", source.supplementalFile.trim());
    url.searchParams.set("FORMAT", "JSON");

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch supplemental data for "${source.name}".`);
    }

    const payload = (await response.json()) as unknown[];
    return payload.map((entry) => createSatelliteRecord(parseElementInput(JSON.stringify(entry)), "seed"));
  }

  if (!source.group?.trim()) {
    throw new Error(`Source "${source.name}" is missing a group name.`);
  }

  const url = new URL(GP_ENDPOINT);
  url.searchParams.set("GROUP", source.group.trim());
  url.searchParams.set("FORMAT", "JSON");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch the "${source.name}" group.`);
  }

  const payload = (await response.json()) as unknown[];
  return payload.map((entry) => createSatelliteRecord(parseElementInput(JSON.stringify(entry)), "seed"));
}

function parseTleCatalog(raw: string) {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const entries: string[] = [];

  for (let index = 0; index < lines.length;) {
    if (lines[index]?.startsWith("1 ") && lines[index + 1]?.startsWith("2 ")) {
      entries.push(`${lines[index]}\n${lines[index + 1]}`);
      index += 2;
      continue;
    }

    if (lines[index + 1]?.startsWith("1 ") && lines[index + 2]?.startsWith("2 ")) {
      entries.push(`${lines[index]}\n${lines[index + 1]}\n${lines[index + 2]}`);
      index += 3;
      continue;
    }

    index += 1;
  }

  if (entries.length === 0) {
    throw new Error("The custom URL did not return recognizable TLE or OMM JSON data.");
  }

  return entries;
}

export async function refreshSatelliteRecord(record: import("@/shared/types").SatelliteRecord) {
  return fetchCelestrakSatellite(record.noradId);
}
