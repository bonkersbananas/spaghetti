/**
 * Where a slice's defaults come from in this workshop: a filament from the Pantry (the stand-in only when it has no
 * spool to offer), a plate the Printer page says is owned, and the nozzle fitted (decision 0047). Pure.
 */
import type { Nozzle } from "../attempts.ts";
import type { PrinterSetup, SpoolLike } from "../spools.ts";
import { DEFAULT_SLICING, STAND_IN_FILAMENT } from "./defaults.ts";
import { ENGINE_NOZZLES } from "./orca.ts";
import { normalizeSlicing, type SlicingFilament, type SlicingSettings, withNozzle } from "./settings.ts";

/** A spool as a slice's filament: its plain words (so the slice reads the same without it) and its id. */
export function filamentOfSpool(spool: SpoolLike): SlicingFilament {
  return {
    material: spool.material,
    ...(spool.colorHex ? { colorHex: spool.colorHex.toLowerCase() } : {}),
    ...(spool.colorName ? { colorName: spool.colorName } : {}),
    ...(spool.brand ? { brand: spool.brand } : {}),
    ...(spool.finish ? { finish: spool.finish } : {}),
    spoolId: spool.id,
  };
}

/** AMS slots in order, A1 to D4, then the external holder; a spool on the shelf after them. */
const slotRank = (slot: string | null | undefined) =>
  !slot ? 1_000 : slot === "Ext" ? 100 : (slot.charCodeAt(0) - 65) * 4 + Number(slot.slice(1));

/**
 * The spools a slice can be made with, the likeliest first: what is loaded (in slot order), then the shelf, PLA
 * before other materials within each, empty spools left out.
 */
export function slicingSpools<S extends SpoolLike>(spools: readonly S[]): S[] {
  return spools
    .filter((spool) => spool.remaining !== "empty")
    .sort((a, b) => {
      const loaded = Number(!a.slot) - Number(!b.slot);
      if (loaded) return loaded;
      const pla = Number(a.material.toUpperCase() !== "PLA") - Number(b.material.toUpperCase() !== "PLA");
      return pla || slotRank(a.slot) - slotRank(b.slot);
    });
}

/** The filament a model is sliced with when nobody chose one: the first of `slicingSpools`, else the stand-in. */
export function pantryFilament(spools: readonly SpoolLike[]): SlicingFilament {
  const spool = slicingSpools(spools)[0];
  return spool ? filamentOfSpool(spool) : STAND_IN_FILAMENT;
}

/** The plate a slice is for when nobody chose one: the X2D's stock plate if it is owned, else the first owned. */
export function ownedPlate(setup: Pick<PrinterSetup, "plates">, preferred = DEFAULT_SLICING.plate): string {
  return setup.plates.includes(preferred) ? preferred : (setup.plates[0] ?? preferred);
}

/** Whether the slicing engine's release has presets for a nozzle size. */
export const engineSlices = (nozzle: number) => ENGINE_NOZZLES.includes(nozzle);

/** A nozzle size that is fitted, and which of the X2D's two nozzles has it. */
export interface FittedNozzle {
  diameter: number;
  /** The main nozzle (direct drive, on the left) or the auxiliary (Bowden, on the right). */
  nozzle: Nozzle;
}

/**
 * The nozzle sizes fitted, the main nozzle's first: one when both nozzles are the same size, when there is nothing
 * to choose between.
 */
export function fittedNozzles(setup: Pick<PrinterSetup, "nozzles">): FittedNozzle[] {
  const { main, auxiliary } = setup.nozzles;
  return main.diameter === auxiliary.diameter
    ? [{ diameter: main.diameter, nozzle: "main" }]
    : [
        { diameter: main.diameter, nozzle: "main" },
        { diameter: auxiliary.diameter, nozzle: "auxiliary" },
      ];
}

/**
 * The nozzle a model nobody set up is sliced for: the one the Printer page's defaults name while it is fitted, else
 * the main nozzle's size.
 */
export function defaultNozzle(setup: Pick<PrinterSetup, "nozzles" | "slicing">): number {
  const wanted = setup.slicing?.nozzle;
  return fittedNozzles(setup).some((fitted) => fitted.diameter === wanted) && wanted !== undefined
    ? wanted
    : setup.nozzles.main.diameter;
}

/**
 * What a model nobody set up is sliced with here: `base` (Spaghetti's defaults) with the workspace's own from the
 * Printer page (how it prints: quality, strength, supports, brim), a filament from the Pantry when the base names
 * none of its own, a plate that is owned and a nozzle that is fitted (`defaultNozzle`), its layer height the same
 * named quality on that nozzle (`withNozzle`).
 */
export function workshopDefaults(
  { spools, setup }: { spools: readonly SpoolLike[]; setup: PrinterSetup },
  given: SlicingSettings = DEFAULT_SLICING,
): SlicingSettings {
  const own = setup.slicing ? normalizeSlicing({ ...given, ...setup.slicing }, given) : given;
  const base = withNozzle(own, defaultNozzle(setup));
  // The base's spool while it is still in the pantry with filament on it, else the likeliest one.
  const named = base.filaments[0]?.spoolId;
  const spool = named ? spools.find((candidate) => candidate.id === named && candidate.remaining !== "empty") : null;
  return normalizeSlicing(
    {
      ...base,
      filaments: [spool ? filamentOfSpool(spool) : pantryFilament(spools)],
      plate: ownedPlate(setup, base.plate),
    },
    base,
  );
}
