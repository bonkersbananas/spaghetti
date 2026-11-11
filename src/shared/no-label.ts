import type { LabelField } from "./label-read.ts";

/** A spool with nothing from a label: what a spool made on the device starts with. */
export const NO_LABEL = {
  diameterMm: null,
  nozzleTempMin: null,
  nozzleTempMax: null,
  bedTempMin: null,
  bedTempMax: null,
  dryTempC: null,
  dryHours: null,
  productCode: null,
  fromLabel: [] as LabelField[],
  labelRead: null,
};
