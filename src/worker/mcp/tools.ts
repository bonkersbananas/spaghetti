import { z } from "zod";
import type {
  AttemptHit,
  AttemptResponse,
  FinishAttemptResponse,
  ItemHit,
  PrinterResponse,
  SearchResponse,
  SpoolsResponse,
  WhatWorkedResponse,
} from "../../shared/api.ts";
import { FAILURE_TAGS, OUTCOME_LABELS, OUTCOMES, SUCCESS_NOTES } from "../../shared/attempts.ts";
import { OUTCOME_FILTERS } from "../../shared/journal.ts";
import { SLOT_PATTERN } from "../../shared/spools.ts";
import { describeResults, describeSettings } from "../../shared/story.ts";
import { settings as attemptSettings } from "../routes/attempts.ts";
import { fromBase64, fromUrl, readImage } from "./image.ts";

/** What a tool can do: call Spaghetti's own API as the agent (same token, same scopes, same "via"). */
export interface ApiResult {
  ok: boolean;
  status: number;
  json: unknown;
  text: string;
}
export interface ToolContext {
  call: (path: string, init?: { method?: string; json?: unknown; form?: FormData }) => Promise<ApiResult>;
}
export interface ToolResult {
  text: string;
  isError?: boolean;
}

const failure = (result: ApiResult): ToolResult => {
  const message = (result.json as { error?: { message?: string } } | null)?.error?.message;
  return { text: message ?? `The request failed (${result.status}).`, isError: true };
};

export interface Tool {
  name: string;
  title: string;
  description: string;
  /** Needs these scopes (any of); the API checks them. Said in the description too. */
  scopes: string[];
  input: z.ZodObject;
  readOnly: boolean;
  run: (args: never, ctx: ToolContext) => Promise<ToolResult>;
}

/** Declares a tool with its arguments typed from the schema. */
function tool<S extends z.ZodObject>(
  definition: Omit<Tool, "run" | "input"> & {
    input: S;
    run: (args: z.infer<S>, ctx: ToolContext) => Promise<ToolResult>;
  },
): Tool {
  return definition as unknown as Tool;
}

const slugs = (list: readonly { slug: string }[]) => list.map((tag) => tag.slug).join(", ");
const id = z.uuid();

const settingsArg = attemptSettings
  .optional()
  .describe(
    "What the print was made with: filaments (type, brand, colorName, amsSlot), layerHeight (mm), infillDensity (%), bedType, nozzleTemperature and bedTemperature (°C), brim, supports and more. Leave out what you don't know. Left out entirely, it starts from the previous attempt's settings, as in the app.",
  );
const noteArg = z.string().max(20_000).optional();
const failureTagsArg = z
  .array(z.string())
  .optional()
  .describe(`What went wrong, as tag slugs. Built in: ${slugs(FAILURE_TAGS)}.`);
const successNotesArg = z
  .array(z.string())
  .optional()
  .describe(`What went well, as tag slugs. Built in: ${slugs(SUCCESS_NOTES)}.`);
const outcomeArg = z
  .enum(OUTCOMES)
  .describe(`How it went: ${OUTCOMES.map((outcome) => `"${outcome}" (${OUTCOME_LABELS[outcome]})`).join(", ")}.`);
const materialArg = z.string().max(20).optional().describe('A filament type such as "PLA", "PETG" or "TPU".');

// --- formatting: short text a model can read and act on ------------------------------------------

const outcomeWord = (outcome: string | null) =>
  outcome ? OUTCOME_LABELS[outcome as keyof typeof OUTCOME_LABELS] : "printing";

function itemLine(hit: ItemHit): string {
  const name = hit.item.title?.trim() || hit.item.note.split("\n")[0]?.slice(0, 80) || "Untitled";
  const attempts = hit.attempts
    ? `, ${hit.attempts} ${hit.attempts === 1 ? "attempt" : "attempts"}, last ${outcomeWord(hit.lastOutcome)}`
    : "";
  return `- ${name} (${hit.item.stage}${attempts}) build_id: ${hit.item.id}`;
}

function attemptLine(hit: AttemptHit & { sameBuild?: boolean }): string {
  const a = hit.attempt;
  const settings = describeSettings(a.settings);
  const results = describeResults(a.settings);
  const name = hit.item.title?.trim() || "Untitled";
  return [
    `- ${name}, attempt ${hit.number}: ${outcomeWord(a.outcome)}${hit.sameBuild ? " (this build)" : ""} (build_id: ${hit.item.id}, attempt_id: ${a.id})`,
    a.note.trim() && `  note: ${a.note.trim()}`,
    settings.length && `  settings: ${settings.join(", ")}`,
    results.length && `  result: ${results.join(", ")}`,
    a.failureTags.length && `  went wrong: ${a.failureTags.join(", ")}`,
    a.successNotes.length && `  went well: ${a.successNotes.join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// --- the tools -----------------------------------------------------------------------------------

export const tools: Tool[] = [
  tool({
    name: "search",
    title: "Search the journal",
    description:
      'Search Spaghetti, the two people\'s 3D-printing notebook, for ideas, builds and print attempts. Use it to find a build_id, or to recall what was tried before ("warping PETG", "bracket"). Words match titles, notes, tags and settings. Filter attempts by outcome and material. Needs the "read" scope.',
    scopes: ["read"],
    readOnly: true,
    input: z.object({
      query: z.string().max(200).optional().describe("Words to find, such as a part name or a problem."),
      outcome: z
        .enum(OUTCOME_FILTERS)
        .optional()
        .describe(
          'Only attempts that ended this way: "failures" (partly or spaghetti), "success", "partial" or "failed".',
        ),
      material: materialArg,
      tag: z.string().max(48).optional().describe("Only attempts with this failure tag or success note slug."),
    }),
    async run(args, ctx) {
      const query = new URLSearchParams();
      if (args.query) query.set("q", args.query);
      if (args.outcome) query.set("outcome", args.outcome);
      if (args.material) query.set("material", args.material);
      if (args.tag) query.set("tag", args.tag);
      const result = await ctx.call(`/api/search?${query}`);
      if (!result.ok) return failure(result);
      const found = result.json as SearchResponse;
      const sections = [
        found.builds.length && `Builds:\n${found.builds.map(itemLine).join("\n")}`,
        found.ideas.length && `Ideas:\n${found.ideas.map(itemLine).join("\n")}`,
        found.attempts.length && `Attempts:\n${found.attempts.map(attemptLine).join("\n")}`,
      ].filter(Boolean);
      return {
        text: sections.length ? sections.join("\n\n") : "Nothing found. Search needs words or at least one filter.",
      };
    },
  }),

  tool({
    name: "what_worked",
    title: "What worked last time",
    description:
      'Find the latest print attempts that worked, with their settings, to start from. Give a build_id (its own successes come first), a material, or free text (searched among successful attempts); combine them to narrow it. Needs the "read" scope.',
    scopes: ["read"],
    readOnly: true,
    input: z.object({
      build_id: id.optional().describe("A build or idea id (from search). Its own successful attempts come first."),
      material: materialArg,
      query: z
        .string()
        .max(200)
        .optional()
        .describe('Free text, such as "overhangs" or "hinge", searched among attempts that worked.'),
    }),
    async run(args, ctx) {
      if (!args.build_id && !args.material && !args.query) {
        return { text: "Give a build_id, a material or some words to look for.", isError: true };
      }
      let hits: Array<AttemptHit & { sameBuild?: boolean }>;
      if (args.build_id && !args.query) {
        const query = new URLSearchParams({ item: args.build_id });
        if (args.material) query.set("material", args.material);
        const result = await ctx.call(`/api/what-worked?${query}`);
        if (!result.ok) return failure(result);
        hits = (result.json as WhatWorkedResponse).matches;
      } else {
        const query = new URLSearchParams({ outcome: "success" });
        if (args.query) query.set("q", args.query);
        if (args.material) query.set("material", args.material);
        const result = await ctx.call(`/api/search?${query}`);
        if (!result.ok) return failure(result);
        hits = (result.json as SearchResponse).attempts;
        if (args.build_id)
          hits = hits.sort((a, b) => Number(b.item.id === args.build_id) - Number(a.item.id === args.build_id));
      }
      return { text: hits.length ? hits.map(attemptLine).join("\n") : "No successful attempt matches yet." };
    },
  }),

  tool({
    name: "get_build",
    title: "Read a build's whole story",
    description:
      'Get one build (or idea) as a single markdown document: the idea and its notes, every attempt in order with outcome, settings, what changed from the one before, notes and tags, and what worked. Use the id from search. Needs the "read" scope.',
    scopes: ["read"],
    readOnly: true,
    input: z.object({ build_id: id.describe("The build's or idea's id.") }),
    async run(args, ctx) {
      const result = await ctx.call(`/api/builds/${args.build_id}/story.md`);
      return result.ok ? { text: result.text } : failure(result);
    },
  }),

  tool({
    name: "capture_idea",
    title: "Capture an idea",
    description:
      'Add an idea to the inbox, the way people do from their phone: a title and/or a note, optionally a photo. Titles are optional; a note is fine on its own. The idea shows in the app marked as made via this agent. Needs the "capture" scope.',
    scopes: ["capture"],
    readOnly: false,
    input: z.object({
      title: z.string().max(200).optional().describe("A short name, if there is one. Optional."),
      note: z.string().max(20_000).optional().describe("The thought itself: what it is, a link, a measurement."),
      photo_url: z.string().max(2000).optional().describe("An https URL of a JPEG or WebP photo to attach."),
      photo_base64: z.string().optional().describe("Or the photo itself as base64 (JPEG or WebP, up to 12 MB)."),
    }),
    async run(args, ctx) {
      if (!args.title?.trim() && !args.note?.trim() && !args.photo_url && !args.photo_base64) {
        return { text: "Give a title, a note or a photo.", isError: true };
      }
      let image: ReturnType<typeof readImage> | undefined;
      try {
        if (args.photo_base64) image = readImage(fromBase64(args.photo_base64));
        else if (args.photo_url) image = readImage(await fromUrl(args.photo_url));
      } catch (error) {
        return { text: error instanceof Error ? error.message : "The photo couldn't be read.", isError: true };
      }
      const itemId = crypto.randomUUID();
      const created = await ctx.call("/api/items", {
        method: "POST",
        json: { id: itemId, title: args.title?.trim() || null, note: args.note ?? "" },
      });
      if (!created.ok) return failure(created);
      let photo = "";
      if (image) {
        const form = new FormData();
        form.set("width", String(image.width));
        form.set("height", String(image.height));
        // The average color is worked out in the browser; a neutral one stands in until then.
        form.set("color", "#a9a095");
        // Nothing here can resize: the one image serves as both sizes.
        const file = () => new File([image.bytes], "photo", { type: image.contentType });
        form.set("large", file());
        form.set("thumb", file());
        const uploaded = await ctx.call(`/api/items/${itemId}/photos/${crypto.randomUUID()}`, { method: "PUT", form });
        photo = uploaded.ok
          ? " Its photo was added."
          : ` The idea was saved but its photo wasn't: ${failure(uploaded).text}`;
      }
      return { text: `Captured idea. build_id: ${itemId}.${photo}` };
    },
  }),

  tool({
    name: "start_attempt",
    title: "Start a print attempt",
    description:
      'Log that a print has started on a build (or on an idea, which then becomes a build): an attempt with no outcome yet, shown as printing. Finish it later with finish_attempt. Without settings it starts from the previous attempt\'s, as in the app. Needs the "attempts" scope.',
    scopes: ["attempts"],
    readOnly: false,
    input: z.object({
      build_id: id.describe("The build's or idea's id (from search)."),
      note: noteArg.describe("A line about what this attempt is trying."),
      settings: settingsArg,
    }),
    async run(args, ctx) {
      const result = await ctx.call(`/api/items/${args.build_id}/attempts`, {
        method: "POST",
        json: { id: crypto.randomUUID(), outcome: null, note: args.note, settings: args.settings },
      });
      if (!result.ok) return failure(result);
      const attempt = (result.json as AttemptResponse).attempt;
      return { text: `Attempt started and printing. attempt_id: ${attempt.id}. Finish it with finish_attempt.` };
    },
  }),

  tool({
    name: "log_attempt",
    title: "Log a finished attempt",
    description:
      'Record a print that is already done, with how it went: outcome, what went wrong or well, a note and the settings. Use start_attempt instead when it is still printing. Needs the "attempts" scope.',
    scopes: ["attempts"],
    readOnly: false,
    input: z.object({
      build_id: id.describe("The build's or idea's id (from search)."),
      outcome: outcomeArg,
      note: noteArg.describe("A line about how it went."),
      failure_tags: failureTagsArg,
      success_notes: successNotesArg,
      settings: settingsArg,
    }),
    async run(args, ctx) {
      const result = await ctx.call(`/api/items/${args.build_id}/attempts`, {
        method: "POST",
        json: {
          id: crypto.randomUUID(),
          outcome: args.outcome,
          note: args.note,
          failureTags: args.failure_tags,
          successNotes: args.success_notes,
          settings: args.settings,
        },
      });
      if (!result.ok) return failure(result);
      return {
        text: `Logged: ${outcomeWord(args.outcome)}. attempt_id: ${(result.json as AttemptResponse).attempt.id}.`,
      };
    },
  }),

  tool({
    name: "finish_attempt",
    title: "Finish a print attempt",
    description:
      'Give a printing attempt its outcome. It only fills what is empty: if someone already finished it, their outcome stands and your note and tags are added. Needs the "attempts" scope.',
    scopes: ["attempts"],
    readOnly: false,
    input: z.object({
      attempt_id: id.describe("The attempt's id (from start_attempt or search)."),
      outcome: outcomeArg,
      note: noteArg.describe("A line about how it went."),
      failure_tags: failureTagsArg,
      success_notes: successNotesArg,
    }),
    async run(args, ctx) {
      const result = await ctx.call(`/api/attempts/${args.attempt_id}/finish`, {
        method: "POST",
        json: {
          outcome: args.outcome,
          note: args.note,
          failureTags: args.failure_tags,
          successNotes: args.success_notes,
        },
      });
      if (!result.ok) return failure(result);
      const done = result.json as FinishAttemptResponse;
      return {
        text: done.finished
          ? `Finished: ${outcomeWord(done.attempt.outcome)}.`
          : `It was already finished as ${outcomeWord(done.attempt.outcome)}; that stands, and your note and tags were added.`,
      };
    },
  }),

  tool({
    name: "list_spools",
    title: "List the filament spools",
    description:
      'List the spools in the pantry (the filament on hand) and which AMS slot each is loaded in, with a spool_id for load_slot. "remaining" is rough: full, most, half, low or empty. Needs the "read" scope.',
    scopes: ["read"],
    readOnly: true,
    input: z.object({}),
    async run(_args, ctx) {
      const [spools, printer] = await Promise.all([ctx.call("/api/spools"), ctx.call("/api/printer")]);
      if (!spools.ok) return failure(spools);
      const list = (spools.json as SpoolsResponse).spools;
      const slots = printer.ok ? (printer.json as PrinterResponse).slots : {};
      const lines = list.map((spool) => {
        const name = [spool.brand, spool.material, spool.colorName ?? spool.colorHex].filter(Boolean).join(" ");
        return `- ${name}${spool.finish ? ` (${spool.finish})` : ""}: ${spool.remaining}${spool.slot ? `, loaded in ${spool.slot}` : ""} (spool_id: ${spool.id})`;
      });
      const loaded = Object.entries(slots).length;
      return { text: lines.length ? `${lines.join("\n")}\n\n${loaded} of the slots are loaded.` : "No spools yet." };
    },
  }),

  tool({
    name: "load_slot",
    title: "Load a spool into an AMS slot",
    description:
      'Record which spool is in an AMS slot ("A1" to "D4", or "Ext" for the external holder), taking it out of the slot it was in. Pass spool_id null to mark the slot empty. This only updates Spaghetti\'s record; it never touches the printer. Needs the "printer" scope.',
    scopes: ["printer"],
    readOnly: false,
    input: z.object({
      slot: z.string().regex(SLOT_PATTERN).describe('"A1".."D4" (AMS unit letter and slot number) or "Ext".'),
      spool_id: id.nullable().describe("A spool_id from list_spools, or null to empty the slot."),
    }),
    async run(args, ctx) {
      const result = await ctx.call(`/api/printer/slots/${args.slot}`, {
        method: "PUT",
        json: { spoolId: args.spool_id },
      });
      if (!result.ok) return failure(result);
      return { text: args.spool_id ? `Loaded into ${args.slot}.` : `${args.slot} is now empty.` };
    },
  }),
];

export const toolByName = new Map(tools.map((entry) => [entry.name, entry]));

/** A tool as `tools/list` shows it. */
export function describeTool(entry: Tool) {
  return {
    name: entry.name,
    title: entry.title,
    description: entry.description,
    inputSchema: z.toJSONSchema(entry.input, { io: "input", unrepresentable: "any" }),
    annotations: { title: entry.title, readOnlyHint: entry.readOnly, destructiveHint: false, openWorldHint: false },
  };
}
