import { type AttemptFilament, type AttemptSettings, plateName, shortPreset } from "@shared/attempts";
import { formatDuration as formatMinutes } from "@/components/ui/Field";

export { formatMinutes };

/** "Jade white Bambu PLA" or "PLA". */
export function filamentLabel(filament: AttemptFilament): string {
  return [filament.colorName, filament.brand, filament.type].filter(Boolean).join(" ") || "Filament";
}

const decimals = (value: number, places: number) => value.toFixed(places);

/**
 * The settings in a few short pieces, for a timeline entry or a collapsed
 * settings row: "Textured PEI", "0.20 mm", "15% infill", "bed 60 °C".
 * Filaments are shown on their own, with their swatches.
 */
export function summarizeSettings(settings: AttemptSettings): string[] {
  const parts: string[] = [];
  if (settings.processPreset) parts.push(shortPreset(settings.processPreset));
  // "0.20mm Standard" already says the layer height.
  const layer = settings.layerHeight === undefined ? undefined : decimals(settings.layerHeight, 2);
  if (layer && !settings.processPreset?.startsWith(`${layer}mm`)) parts.push(`${layer} mm`);
  if (settings.infillDensity !== undefined) parts.push(`${settings.infillDensity}% infill`);
  if (settings.wallLoops !== undefined)
    parts.push(`${settings.wallLoops} ${settings.wallLoops === 1 ? "wall" : "walls"}`);
  if (settings.bedType) parts.push(plateName(settings.bedType));
  if (settings.nozzle === "auxiliary") parts.push("aux nozzle");
  if (settings.nozzleDiameter !== undefined && settings.nozzleDiameter !== 0.4) {
    parts.push(`${settings.nozzleDiameter} mm nozzle`);
  }
  if (settings.supportEnabled) parts.push(settings.supportType === "tree" ? "tree supports" : "supports");
  if (settings.brim) parts.push("brim");
  if (settings.nozzleTemperature !== undefined) parts.push(`nozzle ${settings.nozzleTemperature} °C`);
  if (settings.bedTemperature !== undefined) parts.push(`bed ${settings.bedTemperature} °C`);
  if (settings.chamberTemperature !== undefined) parts.push(`chamber ${settings.chamberTemperature} °C`);
  if (settings.filamentDried) parts.push("dried");
  return parts;
}

/** What happened, in short pieces: "took 2 h 25 min", "38 g", "failed at 40%". */
export function summarizeResults(settings: AttemptSettings): string[] {
  const parts: string[] = [];
  if (settings.failedAtPercent !== undefined) parts.push(`failed at ${settings.failedAtPercent}%`);
  if (settings.failedAtLayer !== undefined) parts.push(`failed at layer ${settings.failedAtLayer}`);
  if (settings.actualMinutes !== undefined) parts.push(`took ${formatMinutes(settings.actualMinutes)}`);
  else if (settings.estimatedMinutes !== undefined) parts.push(`est. ${formatMinutes(settings.estimatedMinutes)}`);
  if (settings.weightGrams !== undefined) parts.push(`${settings.weightGrams} g`);
  return parts;
}

/** Whether there is anything to show at all. */
export function hasSettings(settings: AttemptSettings): boolean {
  return (
    !!settings.filaments?.length || summarizeSettings(settings).length > 0 || summarizeResults(settings).length > 0
  );
}
