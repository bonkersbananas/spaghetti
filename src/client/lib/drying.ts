import { DRYING_DAYS } from "@shared/drying";
import { usePrinterSetup } from "./pantry";

/** The days each material stays dry: the starting values with this printer's own laid over. */
export function useDryingDays(): Record<string, number> {
  const overrides = usePrinterSetup().dryingDays;
  return overrides ? { ...DRYING_DAYS, ...overrides } : { ...DRYING_DAYS };
}
