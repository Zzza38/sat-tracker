import { json2satrec, twoline2satrec } from "satellite.js";
import { OmmElements, SatelliteRecord, TleElements } from "@/shared/types";

export interface ParsedElementInput {
  name: string;
  noradId: string;
  epoch?: string;
  format: "tle" | "omm";
  tle?: TleElements;
  omm?: OmmElements;
}

export function parseElementInput(raw: string): ParsedElementInput {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Paste a TLE, 3LE, or OMM JSON payload first.");
  }

  if (trimmed.startsWith("{")) {
    return parseOmmInput(trimmed);
  }

  return parseTleInput(trimmed);
}

export function validateTleChecksum(line: string) {
  if (line.length < 69) {
    return false;
  }

  const expected = Number(line[68]);
  const checksum = line
    .slice(0, 68)
    .split("")
    .reduce((sum, char) => {
      if (/\d/.test(char)) {
        return sum + Number(char);
      }

      if (char === "-") {
        return sum + 1;
      }

      return sum;
    }, 0) % 10;

  return checksum === expected;
}

export function createSatelliteRecord(parsed: ParsedElementInput, source: SatelliteRecord["source"]): SatelliteRecord {
  return {
    id: parsed.noradId,
    noradId: parsed.noradId,
    name: parsed.name,
    format: parsed.format,
    source,
    fetchedAt: new Date().toISOString(),
    epoch: parsed.epoch,
    tle: parsed.tle,
    omm: parsed.omm,
    internationalDesignator: parsed.omm?.OBJECT_ID
  };
}

function parseTleInput(raw: string): ParsedElementInput {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let name: string | undefined;
  let line1: string;
  let line2: string;

  if (lines.length >= 3 && lines[0].startsWith("0 ")) {
    name = lines[0].slice(2).trim();
    [line1, line2] = lines.slice(1, 3);
  } else if (lines.length >= 3 && !lines[0].startsWith("1 ")) {
    [name, line1, line2] = lines.slice(0, 3);
  } else if (lines.length >= 2) {
    [line1, line2] = lines.slice(0, 2);
  } else {
    throw new Error("TLE input needs two lines of elements, with an optional name.");
  }

  if (!line1.startsWith("1 ") || !line2.startsWith("2 ")) {
    throw new Error("The pasted lines do not look like a valid TLE.");
  }

  if (!validateTleChecksum(line1) || !validateTleChecksum(line2)) {
    throw new Error("The TLE checksum is invalid.");
  }

  const satrec = twoline2satrec(line1, line2);
  const noradId = satrec.satnum.toString();

  return {
    name: name?.trim() || `NORAD ${noradId}`,
    noradId,
    epoch: tleEpochToIso(line1),
    format: "tle",
    tle: {
      name,
      line1,
      line2
    }
  };
}

function parseOmmInput(raw: string): ParsedElementInput {
  const parsed = JSON.parse(raw) as OmmElements;
  const satrec = json2satrec(parsed);
  const noradId = String(parsed.NORAD_CAT_ID ?? satrec.satnum);
  return {
    name: String(parsed.OBJECT_NAME ?? `NORAD ${noradId}`),
    noradId,
    epoch: String(parsed.EPOCH ?? ""),
    format: "omm",
    omm: parsed
  };
}

function tleEpochToIso(line1: string) {
  const year = Number(line1.slice(18, 20));
  const dayOfYear = Number(line1.slice(20, 32));
  const fullYear = year < 57 ? 2000 + year : 1900 + year;
  const date = new Date(Date.UTC(fullYear, 0, 1));
  date.setTime(date.getTime() + (dayOfYear - 1) * 86400000);
  return date.toISOString();
}
