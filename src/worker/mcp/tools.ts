import { z } from "zod";
import type { AgentScope } from "../../shared/agents.ts";
import type {
  AttemptHit,
  AttemptResponse,
  FinishAttemptResponse,
  ItemHit,
  ItemResponse,
  Photo,
  PrinterResponse,
  Recipe,
  RecipesResponse,
  SearchResponse,
  SpoolResponse,
  SpoolsResponse,
  UpkeepResponse,
  WhatWorkedResponse,
} from "../../shared/api.ts";
import { FAILURE_TAGS, OUTCOME_LABELS, OUTCOMES, SUCCESS_NOTES } from "../../shared/attempts.ts";
import { COMMENT_MAX } from "../../shared/comments.ts";
import { OUTCOME_FILTERS } from "../../shared/journal.ts";
import type { ScoutResponse } from "../../shared/scout.ts";
import { SLOT_PATTERN } from "../../shared/spools.ts";
import { describeResults, describeSettings } from "../../shared/story.ts";
import { formatHours, sinceWords } from "../../shared/upkeep.ts";
import { mondayOf, printsWords, type WeekResponse } from "../../shared/week.ts";
import { settings as attemptSettings } from "../routes/attempts.ts";
import { fromBase64, fromPublicUrl, readImage, toBase64 } from "./image.ts";

/** What a tool can do: call Spaghetti's own API as the agent (same token, same scopes, same "via"). */
export interface ApiResult {
  ok: boolean;
  status: number;
  json: unknown;
  text: string;
  /** The body of a `binary` call that succeeded. */
  bytes?: Uint8Array;
  contentType?: string;
}
export interface ToolContext {
  call: (
    path: string,
    init?: { method?: string; json?: unknown; form?: FormData; binary?: boolean },
  ) => Promise<ApiResult>;
  /** The token's scopes, for a tool that must know before it fetches anything. */
  scopes: readonly AgentScope[];
}
export interface ToolResult {
  text: string;
  isError?: boolean;
  /** Pictures for Claude to look at, as MCP image content. */
  images?: Array<{ data: string; mimeType: string }>;
}

const failure = (result: ApiResult): ToolResult => {
  const message = (result.json as { error?: { message?: string } } | null)?.error?.message;
  return { text: message ?? `The request failed (${result.status}).`, isError: true };
};

export interface Tool {
  name: string;
  title: string;
  description: string;
  /** Needs these scopes (any of): checked before the tool runs, and again by the API it calls. Said in the description too. */
  scopes: AgentScope[];
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
const partsArg = z
  .array(
    z.object({
      part_id: id.describe("The part's id, from get_build's Parts list."),
      count: z.number().int().min(0).max(999).describe("Good pieces of that part that came out (or are on the plate)."),
    }),
  )
  .max(100)
  .optional()
  .describe(
    "For a build with parts: which parts the print made and how many good pieces of each. Worked and partly worked prints count their pieces; a spaghetti counts none unless you say a number. Leave out for a build without parts.",
  );
const toPartCounts = (parts: Array<{ part_id: string; count: number }> | undefined) =>
  parts?.map((part) => ({ partId: part.part_id, count: part.count }));
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

function recipeLine(recipe: Recipe): string {
  const settings = describeSettings(recipe.settings);
  return [
    `- Recipe "${recipe.name}" for ${[recipe.finish, recipe.material].filter(Boolean).join(" ")} (recipe_id: ${recipe.id}${recipe.source ? `, from build_id: ${recipe.source.itemId}, attempt_id: ${recipe.source.attemptId}` : ""})`,
    recipe.note.trim() && `  note: ${recipe.note.trim()}`,
    settings.length && `  settings: ${settings.join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function attemptLine(hit: AttemptHit & { sameBuild?: boolean }): string {
  const a = hit.attempt;
  const settings = describeSettings(a.settings);
  const results = describeResults(a.settings);
  const name = hit.item.title?.trim() || "Untitled";
  return [
    `- ${name}, attempt ${hit.number}${hit.partsLabel ? ` · ${hit.partsLabel}` : ""}: ${outcomeWord(a.outcome)}${hit.sameBuild ? " (this build)" : ""} (build_id: ${hit.item.id}, attempt_id: ${a.id})`,
    a.note.trim() && `  note: ${a.note.trim()}`,
    settings.length && `  settings: ${settings.join(", ")}`,
    results.length && `  result: ${results.join(", ")}`,
    a.failureTags.length && `  went wrong: ${a.failureTags.join(", ")}`,
    a.successNotes.length && `  went well: ${a.successNotes.join(", ")}`,
    hit.photo && `  photo_id: ${hit.photo.id} (look at it with get_photo)`,
  ]
    .filter(Boolean)
    .join("\n");
}

// --- photos --------------------------------------------------------------------------------------

const photoUrlArg = z.string().max(2000).optional().describe("An https URL of a JPEG or WebP photo.");
const photoBase64Arg = z.string().optional().describe("Or the photo itself as base64 (JPEG or WebP, up to 12 MB).");

/** A picture sent to Claude stays under this (base64 makes it a third bigger): well under what claude.ai takes in a result. */
const MAX_SHOWN_BYTES = 900_000;
/** Pictures in one get_photo answer. */
const MAX_SHOWN = 4;

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Where a photo belongs, in words: "the idea" or "attempt 2". */
function photoPlace(photo: Photo, attemptNumbers: Map<string, number>): string {
  const number = photo.attemptId ? attemptNumbers.get(photo.attemptId) : undefined;
  return number ? `attempt ${number}` : "the idea/build";
}

function photoLine(photo: Photo, place: string): string {
  const taken = dayOf(photo.takenAt ?? photo.createdAt);
  return `photo_id: ${photo.id} (${place}, ${photo.takenAt ? "taken" : "added"} ${taken}, ${photo.width}×${photo.height}${photo.needsResize ? ", original size" : ""})`;
}

/** Reads and uploads one photo to an item (and attempt), the way capture_idea does. */
async function readPhotoArgs(args: { photo_url?: string; photo_base64?: string }) {
  if (args.photo_base64) return readImage(fromBase64(args.photo_base64));
  if (args.photo_url) return readImage(await fromPublicUrl(args.photo_url));
  return undefined;
}

async function uploadPhoto(
  ctx: ToolContext,
  itemId: string,
  image: ReturnType<typeof readImage>,
  attemptId?: string,
): Promise<{ ok: true; photo: Photo } | { ok: false; text: string }> {
  const form = new FormData();
  form.set("width", String(image.width));
  form.set("height", String(image.height));
  // The average color is worked out in the browser; a neutral one stands in until then.
  form.set("color", "#a9a095");
  // The next browser that sees the photo resizes it and replaces the two copies below.
  form.set("needsResize", "1");
  if (attemptId) form.set("attemptId", attemptId);
  // Nothing here can resize: the one image serves as both sizes until a browser does it.
  const file = () => new File([image.bytes], "photo", { type: image.contentType });
  form.set("large", file());
  form.set("thumb", file());
  const uploaded = await ctx.call(`/api/items/${itemId}/photos/${crypto.randomUUID()}`, { method: "PUT", form });
  if (!uploaded.ok) return { ok: false, text: failure(uploaded).text };
  return { ok: true, photo: (uploaded.json as { photo: Photo }).photo };
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
      'Find the latest print attempts that worked, with their settings, to start from, and the saved recipes for the material (named settings people keep for how they print it). Give a build_id (its own successes come first), a material, or free text (searched among successful attempts); combine them to narrow it. Needs the "read" scope.',
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
      let recipes: Recipe[] = [];
      if (args.build_id && !args.query) {
        const query = new URLSearchParams({ item: args.build_id });
        if (args.material) query.set("material", args.material);
        const result = await ctx.call(`/api/what-worked?${query}`);
        if (!result.ok) return failure(result);
        hits = (result.json as WhatWorkedResponse).matches;
        recipes = (result.json as WhatWorkedResponse).recipes;
      } else {
        const query = new URLSearchParams({ outcome: "success" });
        if (args.query) query.set("q", args.query);
        if (args.material) query.set("material", args.material);
        const result = await ctx.call(`/api/search?${query}`);
        if (!result.ok) return failure(result);
        hits = (result.json as SearchResponse).attempts;
        recipes = (result.json as SearchResponse).recipes;
        if (args.build_id)
          hits = hits.sort((a, b) => Number(b.item.id === args.build_id) - Number(a.item.id === args.build_id));
      }
      const lines = [...recipes.map(recipeLine), ...hits.map(attemptLine)];
      return { text: lines.length ? lines.join("\n") : "No successful attempt matches yet." };
    },
  }),

  tool({
    name: "get_build",
    title: "Read a build's whole story",
    description:
      'Get one build (or idea) as a single markdown document: the idea and its notes, every attempt in order with outcome, settings, what changed from the one before, notes and tags, and what worked, and a Photos list (photo_id, what it belongs to, when, size) of every picture. To look at a picture, use get_photo with the build_id and a photo_id. Use the id from search. Needs the "read" scope.',
    scopes: ["read"],
    readOnly: true,
    input: z.object({ build_id: id.describe("The build's or idea's id.") }),
    async run(args, ctx) {
      const result = await ctx.call(`/api/builds/${args.build_id}/story.md`);
      if (!result.ok) return failure(result);
      const item = await ctx.call(`/api/items/${args.build_id}`);
      const found = item.ok ? (item.json as ItemResponse).item : null;
      if (!found?.photos.length) return { text: result.text };
      const numbers = new Map(found.attempts.map((attempt, index) => [attempt.id, index + 1]));
      const list = found.photos.map((photo) => `- ${photoLine(photo, photoPlace(photo, numbers))}`);
      return {
        text: `${result.text}\n\n## Photos (${found.photos.length})\n\nLook at one with get_photo (build_id: ${found.id}, photo_id).\n\n${list.join("\n")}`,
      };
    },
  }),

  tool({
    name: "get_photo",
    title: "Look at a photo",
    description:
      'Use get_photo to look at or show a photo of an idea, build or print attempt: it comes back as an image. Give the build_id and a photo_id (both are listed by get_build, and search names the photo of an attempt), or an "attempt" number to get that attempt\'s photos, or neither for the build\'s own photos (most recent last, up to "limit", at most 4). Pictures are the app\'s display-size copies, small enough to look at. Needs the "read" scope.',
    scopes: ["read"],
    readOnly: true,
    input: z.object({
      build_id: id.describe("The build's or idea's id."),
      photo_id: id.optional().describe("One photo (from get_build's Photos list)."),
      attempt: z
        .number()
        .int()
        .min(1)
        .max(999)
        .optional()
        .describe("Instead: the photos of this attempt number (attempt 1 is the first)."),
      limit: z.number().int().min(1).max(MAX_SHOWN).optional().describe("How many at most, default 1."),
    }),
    async run(args, ctx) {
      const item = await ctx.call(`/api/items/${args.build_id}`);
      if (!item.ok) return failure(item);
      const found = (item.json as ItemResponse).item;
      const numbers = new Map(found.attempts.map((attempt, index) => [attempt.id, index + 1]));
      let chosen: Photo[];
      if (args.photo_id) {
        chosen = found.photos.filter((photo) => photo.id === args.photo_id);
        if (!chosen.length) return { text: "That photo isn't one of this build's.", isError: true };
      } else if (args.attempt) {
        const attempt = found.attempts[args.attempt - 1];
        if (!attempt) return { text: `This build has no attempt ${args.attempt}.`, isError: true };
        chosen = found.photos.filter((photo) => photo.attemptId === attempt.id);
      } else {
        chosen = found.photos.filter((photo) => !photo.attemptId);
      }
      if (!chosen.length) return { text: "There are no photos there." };
      const limit = args.photo_id ? 1 : (args.limit ?? 1);
      const images: NonNullable<ToolResult["images"]> = [];
      const lines: string[] = [];
      for (const photo of chosen.slice(0, limit)) {
        // The display copy; when it is big, the thumb stands in. An original no browser has resized yet is stored as
        // both, so asking for the thumb would download the same big file twice: it waits for a browser to resize it.
        let bytes: Uint8Array | undefined;
        let mimeType = "image/webp";
        for (const variant of photo.needsResize ? ["large"] : ["large", "thumb"]) {
          const fetched = await ctx.call(`/api/photos/${photo.id}/${variant}`, { binary: true });
          if (fetched.ok && fetched.bytes && fetched.bytes.length <= MAX_SHOWN_BYTES) {
            bytes = fetched.bytes;
            mimeType = fetched.contentType?.split(";")[0] || mimeType;
            break;
          }
        }
        const line = photoLine(photo, photoPlace(photo, numbers));
        if (!bytes) {
          lines.push(`${line}: too big to show here${photo.needsResize ? " until the app has resized it" : ""}.`);
          continue;
        }
        images.push({ data: toBase64(bytes), mimeType });
        lines.push(line);
      }
      const more =
        chosen.length > limit ? ` ${chosen.length - limit} more: ask with a photo_id or a higher limit.` : "";
      return { text: `${lines.join("\n")}${more}`, images };
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
      photo_url: photoUrlArg,
      photo_base64: photoBase64Arg,
    }),
    async run(args, ctx) {
      if (!args.title?.trim() && !args.note?.trim() && !args.photo_url && !args.photo_base64) {
        return { text: "Give a title, a note or a photo.", isError: true };
      }
      let image: ReturnType<typeof readImage> | undefined;
      try {
        image = await readPhotoArgs(args);
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
        const uploaded = await uploadPhoto(ctx, itemId, image);
        photo = uploaded.ok ? " Its photo was added." : ` The idea was saved but its photo wasn't: ${uploaded.text}`;
      }
      return { text: `Captured idea. build_id: ${itemId}.${photo}` };
    },
  }),

  tool({
    name: "add_photo",
    title: "Add a photo to an idea, build or attempt",
    description:
      'Add a photo to something that already exists: an idea or build (build_id), or one of its print attempts (also give attempt_id). It goes after the photos already there and shows in the app marked as added via this agent; people can remove it there. Send an https photo_url or photo_base64 (JPEG or WebP, up to 12 MB). Use capture_idea for a new idea. Needs the "capture" scope for an idea or build, the "attempts" scope for an attempt.',
    scopes: ["capture", "attempts"],
    readOnly: false,
    input: z.object({
      build_id: id.describe("The build's or idea's id (from search)."),
      attempt_id: id
        .optional()
        .describe(
          "The attempt the photo shows (from get_build or search); left out, the photo is of the idea or build.",
        ),
      photo_url: photoUrlArg,
      photo_base64: photoBase64Arg,
    }),
    async run(args, ctx) {
      if (!args.photo_url && !args.photo_base64) return { text: "Give a photo_url or photo_base64.", isError: true };
      const needs = args.attempt_id ? "attempts" : "capture";
      if (!ctx.scopes.includes(needs))
        return { text: `This token needs the "${needs}" scope for that.`, isError: true };
      let image: ReturnType<typeof readImage> | undefined;
      try {
        image = await readPhotoArgs(args);
      } catch (error) {
        return { text: error instanceof Error ? error.message : "The photo couldn't be read.", isError: true };
      }
      if (!image) return { text: "Give a photo_url or photo_base64.", isError: true };
      const uploaded = await uploadPhoto(ctx, args.build_id, image, args.attempt_id);
      return uploaded.ok
        ? { text: `Photo added. photo_id: ${uploaded.photo.id}.` }
        : { text: uploaded.text, isError: true };
    },
  }),

  tool({
    name: "add_comment",
    title: "Comment on an idea or build",
    description:
      'Add a comment to the short thread under an idea or build, where the two people talk about it ("Could you print this one in the blue PETG?"). It shows in the app as the owner\'s comment, marked as written via this agent, and counts as new for the other person. Read the thread with get_build (it ends with the comments). Keep it short and plain. Needs the "capture" or "attempts" scope.',
    scopes: ["capture", "attempts"],
    readOnly: false,
    input: z.object({
      build_id: id.describe("The build's or idea's id (from search)."),
      text: z.string().min(1).max(COMMENT_MAX).describe("What to say, in the voice of the person you act for."),
    }),
    async run(args, ctx) {
      const comment = await ctx.call(`/api/items/${args.build_id}/comments`, {
        method: "POST",
        json: { id: crypto.randomUUID(), body: args.text },
      });
      return comment.ok ? { text: "Added your comment to the thread." } : failure(comment);
    },
  }),

  tool({
    name: "set_parts",
    title: "Add or change a build's parts",
    description:
      'Say what a build is made of when it is more than one thing ("Hull half" ×2, "Deck" ×1): adds the parts listed and changes the ones that already exist (give their part_id). Parts are optional; most builds have none. Removing a part is for people, in the app. Needs the "attempts" scope.',
    scopes: ["attempts"],
    readOnly: false,
    input: z.object({
      build_id: id.describe("The build's id (from search)."),
      parts: z
        .array(
          z.object({
            name: z.string().min(1).max(80).describe('The part\'s name, such as "Hull half".'),
            quantity: z.number().int().min(1).max(999).describe("How many are needed."),
            part_id: id.optional().describe("An existing part to rename or change; left out, a new part is added."),
          }),
        )
        .min(1)
        .max(100),
    }),
    async run(args, ctx) {
      const given = args.parts.map((part) => ({
        id: part.part_id ?? crypto.randomUUID(),
        name: part.name,
        quantity: part.quantity,
      }));
      const result = await ctx.call(`/api/items/${args.build_id}/parts`, { method: "PUT", json: { parts: given } });
      if (!result.ok) return failure(result);
      const saved = (result.json as ItemResponse).item.parts;
      return {
        text: `Parts of the build: ${saved.map((part) => `${part.name} ×${part.quantity} (part_id: ${part.id})`).join(", ")}.`,
      };
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
      parts: partsArg,
    }),
    async run(args, ctx) {
      const result = await ctx.call(`/api/items/${args.build_id}/attempts`, {
        method: "POST",
        json: {
          id: crypto.randomUUID(),
          outcome: null,
          note: args.note,
          settings: args.settings,
          parts: toPartCounts(args.parts),
        },
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
      parts: partsArg,
      photo_url: photoUrlArg.describe("An https URL of a JPEG or WebP photo of the print, to attach to the attempt."),
      photo_base64: photoBase64Arg,
    }),
    async run(args, ctx) {
      let image: ReturnType<typeof readImage> | undefined;
      try {
        image = await readPhotoArgs(args);
      } catch (error) {
        return { text: error instanceof Error ? error.message : "The photo couldn't be read.", isError: true };
      }
      const result = await ctx.call(`/api/items/${args.build_id}/attempts`, {
        method: "POST",
        json: {
          id: crypto.randomUUID(),
          outcome: args.outcome,
          note: args.note,
          failureTags: args.failure_tags,
          successNotes: args.success_notes,
          settings: args.settings,
          parts: toPartCounts(args.parts),
        },
      });
      if (!result.ok) return failure(result);
      const attemptId = (result.json as AttemptResponse).attempt.id;
      let photo = "";
      if (image) {
        const uploaded = await uploadPhoto(ctx, args.build_id, image, attemptId);
        photo = uploaded.ok ? " Its photo was added." : ` The attempt was saved but its photo wasn't: ${uploaded.text}`;
      }
      return { text: `Logged: ${outcomeWord(args.outcome)}. attempt_id: ${attemptId}.${photo}` };
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
      parts: partsArg,
      photo_url: photoUrlArg.describe("An https URL of a JPEG or WebP photo of the print, to attach to the attempt."),
      photo_base64: photoBase64Arg,
    }),
    async run(args, ctx) {
      let image: ReturnType<typeof readImage> | undefined;
      try {
        image = await readPhotoArgs(args);
      } catch (error) {
        return { text: error instanceof Error ? error.message : "The photo couldn't be read.", isError: true };
      }
      const result = await ctx.call(`/api/attempts/${args.attempt_id}/finish`, {
        method: "POST",
        json: {
          outcome: args.outcome,
          note: args.note,
          failureTags: args.failure_tags,
          successNotes: args.success_notes,
          parts: toPartCounts(args.parts),
        },
      });
      if (!result.ok) return failure(result);
      const done = result.json as FinishAttemptResponse;
      let photo = "";
      if (image) {
        const uploaded = await uploadPhoto(ctx, done.attempt.itemId, image, args.attempt_id);
        photo = uploaded.ok ? " Its photo was added." : ` The photo wasn't saved: ${uploaded.text}`;
      }
      return {
        text:
          (done.finished
            ? `Finished: ${outcomeWord(done.attempt.outcome)}.`
            : `It was already finished as ${outcomeWord(done.attempt.outcome)}; that stands, and your note and tags were added.`) +
          photo,
      };
    },
  }),

  tool({
    name: "list_recipes",
    title: "List the recipes",
    description:
      'List the saved recipes: named settings of attempts that worked ("Silk PLA, slow outer wall"), with the material, finish, note and a link back to the attempt they came from. Give a material (and finish) to see the ones for a spool. Needs the "read" scope.',
    scopes: ["read"],
    readOnly: true,
    input: z.object({
      material: materialArg,
      finish: z.string().max(40).optional().describe('A finish such as "silk" or "matte".'),
    }),
    async run(args, ctx) {
      const query = new URLSearchParams();
      if (args.material) query.set("material", args.material);
      if (args.finish && args.material) query.set("finish", args.finish);
      const result = await ctx.call(`/api/recipes${query.size ? `?${query}` : ""}`);
      if (!result.ok) return failure(result);
      const list = (result.json as RecipesResponse).recipes;
      return { text: list.length ? list.map(recipeLine).join("\n") : "No recipes saved yet." };
    },
  }),

  tool({
    name: "list_scout_suggestions",
    title: "See the idea scout's suggestions",
    description:
      'List this week\'s three models the idea scout suggested (from MakerWorld or Thingiverse), each with its link, why it fits and whether the two people kept it as an idea or put it away. Read-only: there is no tool to keep or dismiss one, that is for the people. Needs the "read" scope.',
    scopes: ["read"],
    readOnly: true,
    input: z.object({}),
    async run(_args, ctx) {
      const result = await ctx.call("/api/scout");
      if (result.status === 404) return { text: "The idea scout isn't set up." };
      if (!result.ok) return failure(result);
      const { picks } = (result.json as ScoutResponse).scout;
      if (!picks.length) return { text: "The scout has no suggestions this week." };
      return {
        text: picks
          .map((pick) => `- ${pick.title} (${pick.siteName}, ${pick.status}): ${pick.why} ${pick.url}`)
          .join("\n"),
      };
    },
  }),

  tool({
    name: "list_spools",
    title: "List the filament spools",
    description:
      'List the spools in the pantry (the filament on hand) and which AMS slot each is loaded in, with a spool_id for load_slot. "level" is rough: full, half, low or empty. A spool with gram data also says how many grams are left (about), counted down from its weighing or net weight by the prints that used it; its level follows those grams. Needs the "read" scope.',
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
        return `- ${name}${spool.finish ? ` (${spool.finish})` : ""}: ${spool.remaining}${spool.gramsLeft === null ? "" : `, about ${spool.gramsLeft} g left`}${spool.slot ? `, loaded in ${spool.slot}` : ""} (spool_id: ${spool.id})`;
      });
      const loaded = Object.entries(slots).length;
      return { text: lines.length ? `${lines.join("\n")}\n\n${loaded} of the slots are loaded.` : "No spools yet." };
    },
  }),

  tool({
    name: "weigh_spool",
    title: "Weigh a spool",
    description:
      'Record a weighing: a fresh baseline for how many grams are left on a spool. Give on_scale (what the scale says, with the spool; the spool\'s empty weight is taken off) or grams_left. Optionally tare_grams remembers what the empty spool weighs. Needs the "printer" scope.',
    scopes: ["printer"],
    readOnly: false,
    input: z.object({
      spool_id: id.describe("A spool_id from list_spools."),
      on_scale: z.number().min(0).max(40_000).optional().describe("Grams on the scale, spool included."),
      grams_left: z.number().min(0).max(20_000).optional().describe("Grams of filament left, if already worked out."),
      tare_grams: z.number().int().min(0).max(20_000).optional().describe("What the empty spool weighs."),
    }),
    async run(args, ctx) {
      if (args.on_scale === undefined && args.grams_left === undefined) {
        return { text: "Give on_scale or grams_left.", isError: true };
      }
      const result = await ctx.call(`/api/spools/${args.spool_id}/weighings`, {
        method: "POST",
        json: {
          id: crypto.randomUUID(),
          onScale: args.on_scale,
          gramsLeft: args.grams_left,
          tareGrams: args.tare_grams,
        },
      });
      if (!result.ok) return failure(result);
      const left = (result.json as SpoolResponse).spool.gramsLeft;
      return { text: `Weighed: about ${left} g left.` };
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

  tool({
    name: "get_week",
    title: "Look back at a week",
    description:
      'Get one week of the notebook (Monday to Sunday, the workspace\'s time zone): how many prints and how they went, builds finished, ideas captured, comments, filament used, what is waiting, and the paragraph Claude wrote for it when there is one. Leave out "monday" for the week so far. Needs the "read" scope.',
    scopes: ["read"],
    readOnly: true,
    input: z.object({
      monday: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("The week's Monday as YYYY-MM-DD. Defaults to this week."),
    }),
    async run(args, ctx) {
      const result = await ctx.call(`/api/weeks/${args.monday ?? mondayOf(Date.now())}`);
      if (!result.ok) return failure(result);
      const { week } = result.json as WeekResponse;
      const title = (entry: { title: string | null }) => entry.title?.trim() || "untitled";
      const lines = [
        `Week of ${week.monday} to ${week.sunday}.`,
        printsWords(week.prints)
          ? `${printsWords(week.prints)}; ${week.prints.worked} worked, ${week.prints.partly} partly.`
          : "No prints.",
        week.buildsFinished.length ? `Builds finished: ${week.buildsFinished.map(title).join(", ")}.` : "",
        week.ideas.length
          ? `Ideas captured: ${week.ideas.map((idea) => (title(idea) === "untitled" ? idea.note : title(idea))).join("; ")}.`
          : "",
        week.comments.total ? `${week.comments.total} comments.` : "",
        week.grams !== null ? `About ${week.grams} g of filament.` : "",
        week.note?.text ? `Claude's note: ${week.note.text}` : "",
      ];
      return { text: lines.filter(Boolean).join("\n") };
    },
  }),

  tool({
    name: "list_upkeep",
    title: "List the printer's upkeep",
    description:
      "List the printer's maintenance tasks (clean the build plate, lubricate the rods, replace the air filter…), most due first, with how long since each was done, its interval in print hours and/or days, and a task_id for log_upkeep. Also the printer's running total of print hours. Needs the \"read\" scope.",
    scopes: ["read"],
    readOnly: true,
    input: z.object({}),
    async run(_args, ctx) {
      const result = await ctx.call("/api/printer/upkeep");
      if (!result.ok) return failure(result);
      const { printHours, tasks } = result.json as UpkeepResponse;
      const lines = tasks.map((task) => {
        const every = [
          task.intervalHours && `${task.intervalHours} print hours`,
          task.intervalDays && `${task.intervalDays} days`,
        ]
          .filter(Boolean)
          .join(" or ");
        const last = task.lastDone
          ? `last done ${new Date(task.lastDone.doneAt).toISOString().slice(0, 10)}`
          : "never logged";
        return `- ${task.name}: ${task.due ? "DUE, " : ""}${sinceWords(task, task.sinceHours, task.sinceDays)}, every ${every}, ${last} (task_id: ${task.id})`;
      });
      return {
        text: `The printer has ${formatHours(printHours)} of print hours.\n\n${lines.length ? lines.join("\n") : "No upkeep tasks."}`,
      };
    },
  }),

  tool({
    name: "log_upkeep",
    title: "Log that upkeep was done",
    description:
      'Record that a maintenance task was done now (or at "at"): it resets the task and notes the printer\'s print hours at that moment. Optionally a note. Needs the "printer" scope.',
    scopes: ["printer"],
    readOnly: false,
    input: z.object({
      task_id: z.string().min(1).max(40).describe("A task_id from list_upkeep."),
      note: z.string().max(2000).optional().describe("What was done, or what was found."),
      at: z.iso.datetime({ offset: true }).optional().describe("When it was done, if not just now (ISO 8601)."),
    }),
    async run(args, ctx) {
      const result = await ctx.call(`/api/printer/upkeep/${encodeURIComponent(args.task_id)}/done`, {
        method: "POST",
        json: { id: crypto.randomUUID(), note: args.note, at: args.at ? Date.parse(args.at) : undefined },
      });
      if (!result.ok) return failure(result);
      const task = (result.json as UpkeepResponse).tasks.find((entry) => entry.id === args.task_id);
      return { text: task ? `Logged: ${task.name}.` : "Logged." };
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
