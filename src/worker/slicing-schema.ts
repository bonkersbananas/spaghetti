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
  SLICING_PLATES,
  type SlicingDefaults,
  type SlicingSettings,
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
      .enum(["off", "where-needed", "everywhere"])
      .describe(
        "where-needed: only under what would fall (floating parts, long ledges); everywhere: every steep overhang.",
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
 * A workspace's defaults (the Printer page, decision 0049): how a model nobody set up prints. The filament, plate
 * and nozzle aren't among them: they come from the Pantry and the setup.
 */
export const slicingDefaults = slicingSettingsShape
  .pick({ layerHeight: true, walls: true, infill: true, pattern: true, supports: true, supportStyle: true, brim: true })
  .strict()
  .superRefine((value, ctx) => {
    for (const problem of slicingProblems({ ...DEFAULT_SLICING, ...value })) {
      ctx.addIssue({ code: "custom", message: problem });
    }
  })
  .transform((value): SlicingDefaults => slicingDefaultsOf(normalizeSlicing({ ...DEFAULT_SLICING, ...value })))
  .meta({ id: "SlicingDefaults" });
