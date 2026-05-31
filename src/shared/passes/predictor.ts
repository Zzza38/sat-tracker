export {
  predictPassesForSatellite,
  passesToCsv,
  passesToIcs,
  type PassPredictOptions
} from "@/shared/passes/predictor-core";

export async function predictPassesBulk(
  records: Parameters<typeof import("@/shared/passes/predictor-bulk").predictPassesBulkWasm>[0],
  observer: Parameters<typeof import("@/shared/passes/predictor-bulk").predictPassesBulkWasm>[1],
  options?: Parameters<typeof import("@/shared/passes/predictor-bulk").predictPassesBulkWasm>[2]
) {
  const { predictPassesBulkWasm } = await import("@/shared/passes/predictor-bulk");
  return predictPassesBulkWasm(records, observer, options);
}
