/** The starting upkeep list, used by the Worker to seed it (not shipped to the browser). */
import type { UpkeepInterval } from "./upkeep.ts";

export interface DefaultUpkeepTask extends UpkeepInterval {
  id: string;
  name: string;
  note: string;
}

/**
 * The starting list for the X2D. The intervals come from Bambu's maintenance guidance for its other printers
 * and are not confirmed for the X2D (docs/printer.md, "Upkeep"): people edit them.
 */
export const DEFAULT_UPKEEP: readonly DefaultUpkeepTask[] = [
  {
    id: "plate",
    name: "Clean the build plate",
    note: "Warm water and a little dish soap, then dry it. Grease from fingers costs adhesion.",
    intervalHours: 20,
    intervalDays: 14,
  },
  {
    id: "nozzle",
    name: "Clean the nozzle and wiper",
    note: "Pull off any stuck filament and wipe the nozzle tip; swap the wiper if it is frayed.",
    intervalHours: 50,
    intervalDays: 30,
  },
  {
    id: "purge-chute",
    name: "Empty the purge chute",
    note: "Colour changes drop waste there; a full chute jams.",
    intervalHours: 15,
    intervalDays: 14,
  },
  {
    id: "desiccant",
    name: "Replace the AMS desiccant",
    note: "When the indicator turns, or when the AMS stops keeping filament dry.",
    intervalHours: null,
    intervalDays: 60,
  },
  {
    id: "rods",
    name: "Lubricate the rods",
    note: "A thin film of the grease that came with the printer on the linear rods; wipe off the excess.",
    intervalHours: 200,
    intervalDays: 180,
  },
  {
    id: "belts",
    name: "Check the belts",
    note: "Pluck them: both should sound alike and be tight, with no fraying.",
    intervalHours: 300,
    intervalDays: 90,
  },
  {
    id: "air-filter",
    name: "Replace the air filter",
    note: "The carbon and HEPA filter that cleans the chamber air.",
    intervalHours: 300,
    intervalDays: 90,
  },
];
