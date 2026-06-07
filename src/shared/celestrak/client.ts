import { createSatelliteRecord, parseElementInput } from "@/shared/tle/parser";
import { TleSource } from "@/shared/types";

const GP_ENDPOINT = "https://celestrak.org/NORAD/elements/gp.php";
const SUP_GP_ENDPOINT = "https://celestrak.org/NORAD/elements/supplemental/sup-gp.php";
const FETCH_TIMEOUT_MS = 15000;

function validateRemoteUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Custom TLE sources must use HTTP or HTTPS.");
  }

  const hostname = url.hostname.toLowerCase();
  const privateIpv4 =
    /^(?:10|127)\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(hostname);
  if (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".local") ||
    privateIpv4
  ) {
    throw new Error("Custom TLE sources cannot target local or private-network addresses.");
  }

  return url;
}

async function fetchWithTimeout(input: URL | string) {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { signal });
  } catch (caught) {
    if (signal.aborted) {
      throw new Error(`TLE request timed out after ${FETCH_TIMEOUT_MS / 1000} seconds.`, {
        cause: caught
      });
    }
    throw caught;
  }
}

function parseJsonArray(raw: string, sourceName: string) {
  try {
    const payload = JSON.parse(raw) as unknown;
    if (!Array.isArray(payload)) {
      throw new Error("Expected a JSON array.");
    }
    return payload;
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : "Invalid JSON.";
    throw new Error(`"${sourceName}" returned invalid OMM JSON: ${detail}`, { cause: caught });
  }
}

function parseJsonEntries(raw: string, sourceName: string) {
  try {
    const payload = JSON.parse(raw) as unknown;
    return Array.isArray(payload) ? payload : [payload];
  } catch (caught) {
    throw new Error(`"${sourceName}" returned invalid OMM JSON.`, { cause: caught });
  }
}

function recordFromJson(raw: string, sourceName: string) {
  try {
    return createSatelliteRecord(parseElementInput(raw), "seed");
  } catch (caught) {
    const detail = caught instanceof Error ? caught.message : "Invalid JSON record.";
    throw new Error(`"${sourceName}" returned invalid OMM JSON: ${detail}`, { cause: caught });
  }
}

async function* streamJsonRecords(response: Response, sourceName: string) {
  if (!response.body) {
    const entries = parseJsonEntries(await response.text(), sourceName);
    for (const entry of entries) {
      yield recordFromJson(JSON.stringify(entry), sourceName);
    }
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let scanIndex = 0;
  let objectStart = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  let recordCount = 0;

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    for (; scanIndex < buffer.length; scanIndex += 1) {
      const character = buffer[scanIndex];
      if (objectStart < 0) {
        if (character === "{") {
          objectStart = scanIndex;
          depth = 1;
          inString = false;
          escaped = false;
        } else if (!/[\s,[\]]/.test(character)) {
          throw new Error(`"${sourceName}" returned invalid OMM JSON.`);
        }
        continue;
      }

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }

      if (character === '"') {
        inString = true;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          yield recordFromJson(buffer.slice(objectStart, scanIndex + 1), sourceName);
          recordCount += 1;
          buffer = buffer.slice(scanIndex + 1);
          scanIndex = -1;
          objectStart = -1;
        }
      }
    }

    if (done) {
      break;
    }

    if (objectStart > 0) {
      buffer = buffer.slice(objectStart);
      scanIndex -= objectStart;
      objectStart = 0;
    } else if (objectStart < 0 && scanIndex > 0) {
      buffer = buffer.slice(scanIndex);
      scanIndex = 0;
    }
  }

  if (objectStart >= 0 || recordCount === 0 || !/^[\s,\]]*$/.test(buffer)) {
    throw new Error(`"${sourceName}" returned invalid OMM JSON.`);
  }
}

export async function fetchCelestrakSatellite(noradId: string) {
  const ommUrl = new URL(GP_ENDPOINT);
  ommUrl.searchParams.set("CATNR", noradId);
  ommUrl.searchParams.set("FORMAT", "JSON");

  const ommResponse = await fetchWithTimeout(ommUrl);
  if (!ommResponse.ok) {
    throw new Error(`CelesTrak returned ${ommResponse.status} for NORAD ${noradId}.`);
  }

  const ommPayload = parseJsonArray(await ommResponse.text(), `NORAD ${noradId}`);
  const first = ommPayload[0];
  if (!first) {
    throw new Error(`No GP data found for NORAD ${noradId}.`);
  }

  return createSatelliteRecord(parseElementInput(JSON.stringify(first)), "celestrak");
}

async function fetchSourceResponse(source: TleSource) {
  if (source.endpoint === "url") {
    if (!source.url?.trim()) {
      throw new Error(`Source "${source.name}" is missing a URL.`);
    }

    const url = validateRemoteUrl(source.url.trim());
    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch "${source.name}".`);
    }
    return response;
  }

  if (source.endpoint === "supplemental") {
    if (!source.supplementalFile?.trim()) {
      throw new Error(`Source "${source.name}" is missing a supplemental file name.`);
    }

    const url = new URL(SUP_GP_ENDPOINT);
    url.searchParams.set("FILE", source.supplementalFile.trim());
    url.searchParams.set("FORMAT", "JSON");

    const response = await fetchWithTimeout(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch supplemental data for "${source.name}".`);
    }

    return response;
  }

  if (!source.group?.trim()) {
    throw new Error(`Source "${source.name}" is missing a group name.`);
  }

  const url = new URL(GP_ENDPOINT);
  url.searchParams.set("GROUP", source.group.trim());
  url.searchParams.set("FORMAT", "JSON");

  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch the "${source.name}" group.`);
  }

  return response;
}

export async function* iterateTleSource(source: TleSource) {
  const response = await fetchSourceResponse(source);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    yield* streamJsonRecords(response, source.name);
    return;
  }

  const raw = await response.text();
  if (raw.trim().startsWith("[") || raw.trim().startsWith("{")) {
    const entries = parseJsonEntries(raw, source.name);
    for (const entry of entries) {
      yield recordFromJson(JSON.stringify(entry), source.name);
    }
    return;
  }

  for (const entry of parseTleCatalog(raw)) {
    yield createSatelliteRecord(parseElementInput(entry), "seed");
  }
}

export async function fetchTleSource(source: TleSource) {
  const records = [];
  for await (const record of iterateTleSource(source)) {
    records.push(record);
  }
  return records;
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
