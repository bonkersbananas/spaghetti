/**
 * The slicing settings (shared/slicing/settings.ts, decision 0047) as the API takes them: a zod schema for the
 * routes and the OpenAPI document. The shape is spelled out for the document; `slicingProblems` has the last word,
 * so the two can't disagree on what is valid (a layer height the nozzle can't print, say).
 */
import { z } from "zod";
import { DEFAULT_SLICING } from "../shared/slicing/defaults.ts";
import {
  INFILL_PATTERNS,
  LIMITS,
  normalizeSlicing,
  SLICER_IDS,
  SLICING_PLATES,
  type SlicingDefaults,
  type SlicingSettings,
  SUPPORT_PLACEMENT_IDS,
  SUPPORT_STYLE_IDS,
  slicingDefaultsOf,
  slicingProblems,
} from "../shared/slicing/settings.ts";

const slicingFilament = z
  .object({
    material: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .describe('"PLA", "PETG-CF": what the slicer\'s filament preset is picked by.'),
    colorHex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional()
      .describe("#rrggbb; none for the stand-in nobody chose."),
    colorName: z.string().trim().min(1).max(40).optional(),
    brand: z.string().trim().min(1).max(60).optional(),
    finish: z.string().trim().min(1).max(40).optional().describe('The Pantry\'s finish: "basic", "matte", "silk"…'),
    spoolId: z
      .string()
      .regex(/^[\w-]{1,64}$/)
      .optional()
      .describe("The Pantry's spool it was picked from."),
  })
  .strict();

/** A whole set of slicing settings, as the API answers with them. */
export const slicingSettingsShape = z
  .object({
    layerHeight: z
      .number()
      .min(0.04)
      .max(0.56)
      .describe(
        "mm: Fine 0.12, Standard 0.20, Draft 0.24, Extra draft 0.28 for the 0.4 mm nozzle, which prints 0.08 to 0.28.",
      ),
    walls: z.number().int().min(LIMITS.walls.min).max(LIMITS.walls.max),
    infill: z.number().int().min(LIMITS.infill.min).max(LIMITS.infill.max).describe("Percent of the inside filled."),
    pattern: z.enum(INFILL_PATTERNS).describe("The sparse infill pattern, as OrcaSlicer names it."),
    supports: z
      .enum(SUPPORT_PLACEMENT_IDS)
      .describe(
        "where-needed: only under what would fall (floating parts, long ledges); everywhere: every steep overhang; fins: breakaway fins built into the model, with the slicer's supports off.",
      ),
    supportStyle: z.enum(SUPPORT_STYLE_IDS),
    brim: z.enum(["auto", "on", "off"]),
    filaments: z
      .array(slicingFilament)
      .min(1)
      .max(LIMITS.filaments.max)
      .describe("One per filament, filament 1 first."),
    plate: z.enum(SLICING_PLATES as [string, ...string[]]),
    nozzle: z.union([z.literal(0.2), z.literal(0.4), z.literal(0.6), z.literal(0.8)]).describe("mm"),
    scale: z.number().int().min(LIMITS.scale.min).max(LIMITS.scale.max).describe("Percent of the model's own size."),
    orientation: z
      .tuple([z.number(), z.number(), z.number()])
      .nullable()
      .describe(
        "The face the model rests on, as the direction in the model's own axes [x, y, z] that points down; null lays it as the file does.",
      ),
    slicer: z
      .enum(SLICER_IDS)
      .optional()
      .describe(
        "Which slicer slices it (decision 0055): spaghetti, Spaghetti's own (OrcaSlicer's engine steps in for what it can't slice yet); orca, OrcaSlicer's engine. Absent: the default, OrcaSlicer's engine for now.",
      ),
  })
  .strict()
  .meta({ id: "SlicingSettings" });

/** A whole set of slicing settings as the API takes them: checked as `slicingProblems` checks them, and normalized. */
export const slicingSettings = slicingSettingsShape
  .superRefine((value, ctx) => {
    for (const problem of slicingProblems(value)) ctx.addIssue({ code: "custom", message: problem });
  })
  .transform((value): SlicingSettings => normalizeSlicing(value));

/**
 * A workspace's defaults (the Printer page, decision 0051): how a model nobody set up prints. The filament, plate
 * and nozzle aren't among them: they come from the Pantry and the setup.
 */
export const slicingDefaults = slicingSettingsShape
  .pick({
    layerHeight: true,
    walls: true,
    infill: true,
    pattern: true,
    supports: true,
    supportStyle: true,
    brim: true,
    slicer: true,
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const problem of slicingProblems({ ...DEFAULT_SLICING, ...value })) {
      ctx.addIssue({ code: "custom", message: problem });
    }
  })
  .transform((value): SlicingDefaults => slicingDefaultsOf(normalizeSlicing({ ...DEFAULT_SLICING, ...value })))
  .meta({ id: "SlicingDefaults" });
