import { and, desc, eq, isNull } from "drizzle-orm";
import type { AttemptFile, Item } from "../../shared/api.ts";
import {
  type AttemptSettings,
  OUTCOME_LABELS,
  type Outcome,
  plateName,
  shortPreset,
  summarizeBuild,
  type TagDefinition,
  tagLabel,
} from "../../shared/attempts.ts";
import { bestPhoto } from "../../shared/cover.ts";
import { checkLinkUrl } from "../../shared/link-safety.ts";
import {
  modelLetter,
  modelMarkOf,
  modelOf,
  modelPlace,
  sameModel,
  withoutModelLines,
} from "../../shared/model-mark.ts";
import { printablesTitleFromLink } from "../../shared/model-name.ts";
import { attemptPartsLabel, partProgress, progressLabel } from "../../shared/parts.ts";
import { perPiece, sizePiece, sliceLead } from "../../shared/slicing/card.ts";
import { originalFilamentColours, printedFilamentNames } from "../../shared/slicing/colours.ts";
import { slicingOfSlice } from "../../shared/slicing/model.ts";
import { filamentWords, slicingSummary } from "../../shared/slicing/settings.ts";
import { readSize } from "../../shared/slicing/size.ts";
import { slicedBy } from "../../shared/slicing/slicers.ts";
import { problemSentence, standInSentence } from "../../shared/slicing/words.ts";
import { showsSettings } from "../../shared/story-settings.ts";
import { formatDuration } from "../../shared/time.ts";
import { changeName } from "../../shared/twists.ts";
import { keepUnits } from "../../shared/typography.ts";
import { WORKSPACE_TIME_ZONE } from "../../shared/week.ts";
import type { Db } from "../db/index.ts";
import { items, linkPreviews, photos, recipes, tags, twistFiles, twists } from "../db/schema.ts";
import { toApiFile } from "../http.ts";
import { loadItem } from "../routes/items.ts";

/**
 * What a guest sees of one shared thing (decision 0075), and nothing more. Every field is copied here one by one
 * from what the Worker loaded: nothing of the API's own shapes reaches the page, so a field added to items later
 * stays private until someone adds it here on purpose. No people (names, emails, who made what), no comments or
 * reactions, no Up next, wishlists or "for whom", nothing Claude wrote about it, no files to download, no other thing.
 * Files show as their cards (decision 0077): what the print takes and how it is sliced, the plate's picture and, for
 * the 3D view, only the plate's toolpaths, never the file itself.
 */

export interface GuestPhoto {
  id: string;
  width: number;
  height: number;
  /** #rrggbb, checked: the placeholder while it loads (the well's colour when it has none). */
  color: string | null;
}

/** Where the model comes from: always a page on a model site, opened in a new tab without a referrer. */
export interface GuestModel {
  /** "MakerWorld", "Printables". */
  place: string;
  /** The site's letter on the card's tile, as the app's LinkCard draws it ("M" for MakerWorld). */
  letter: string;
  url: string;
  /** What the app's card calls the model: the page's own title, else the draft's, else what a Printables link says. */
  title: string | null;
  designer: string | null;
  license: string | null;
}

export interface GuestSetting {
  label: string;
  value: string;
}

export interface GuestFilament {
  name: string;
  /** #rrggbb, checked, or null for none. */
  color: string | null;
}

/** What the 3D view needs to draw a file's plate (the app's PrintViewer props), besides where its toolpaths are. */
export interface GuestView3d {
  /** The plate, from 1: which plate's G-code the toolpaths are. */
  plate: number;
  /** How many copies of the plate's objects the slice has, and what one measures (mm), for the size it shows. */
  copies?: number;
  size?: [number, number, number];
  /** Colours for filaments the file doesn't colour (an attempt's own filaments), by the slicer's order. */
  fallbackColors?: (string | null)[];
  /** A model with colours of its own: each filament's colour in the model, and what printed it ("Orange PLA"). */
  originalColors?: (string | null)[];
  names?: (string | null)[];
  /** The sliced file's size in bytes: a phone doesn't draw one over the app's line (lib/big-upload.ts). */
  bytes: number;
}

/**
 * A file as its card shows it (the app's FileCard and ModelCard, read-only): what the print takes, how it is sliced,
 * its plate's picture, and whether the plate can be seen in 3D. Never the file: no link to its bytes, no download.
 */
export interface GuestFile {
  /** Its picture (`/s/<token>/files/<id>/thumb`) and the plate's toolpaths (`…/toolpaths`) are fetched by it. */
  id: string;
  /** "fusilli-knob.stl": shown as written, escaped like any text. */
  name: string;
  thumb: boolean;
  /** "About 1 h 26 min", "13.2 g": what the card leads with once it is sliced (with "× 4" for copies). */
  lead: string[];
  /** "About 21 min · 3.3 g each", "29.96 × 11.5 × 11.35 mm", "Sliced by Spaghetti"; or "Plate 2 of 3". */
  meta: string[];
  /** "Plate 1 of 3 · Standard · Everyday strength · No supports": what it is sliced with, as the card's row says it. */
  settings: string[];
  /** What prints it ("PLA Basic jade white"), each with its colour. */
  filaments: GuestFilament[];
  /** "Parts of it float in the air.", or why it couldn't be sliced: said as the card's cautions say them. */
  cautions: string[];
  view: GuestView3d | null;
}

export interface GuestPart {
  name: string;
  /** "1 of 2", "done". */
  progress: string;
  done: boolean;
}

export interface GuestAttempt {
  number: number;
  /** Null while it prints (or waits for its answer). */
  outcome: Outcome | null;
  outcomeLabel: string;
  printedAt: number;
  note: string;
  photos: GuestPhoto[];
  /** "Bed 60 → 65 °C": what changed since the attempt before. */
  changes: string[];
  wentWrong: string[];
  wentWell: string[];
  /** The settings someone would print it with, in words; only where the app lists them (story-settings.ts). */
  settings: GuestSetting[];
  filaments: GuestFilament[];
  /** "Took 2 h 10 min", "38 g", "Failed at 40%". */
  results: string[];
  /** "Hull half ×2, Deck": the parts it printed. */
  printed: string | null;
  /** The file it was printed from, with its 3D view. */
  file: GuestFile | null;
}

interface GuestBase {
  title: string;
  note: string;
  /** The photos to lead with, the cover first. */
  photos: GuestPhoto[];
  /** The one picture link previews use. */
  cover: GuestPhoto | null;
  model: GuestModel | null;
  /** The files kept with it (an idea's or build's models and slicer files; a twist's model), oldest first. */
  files: GuestFile[];
}

export interface GuestIdea extends GuestBase {
  kind: "idea";
  capturedAt: number;
}

export interface GuestBuild extends GuestBase {
  kind: "build";
  /** "In progress", "Done", "On the shelf". */
  stageLabel: string;
  startedAt: number | null;
  finishedAt: number | null;
  attempts: GuestAttempt[];
  /** "3 attempts: 1 spaghetti, 1 partly, 1 worked". */
  summary: string;
  /** "About 6 h 22 min", "At least 130 g". */
  totals: string[];
  /** What it is made of, and how far each part is. */
  parts: GuestPart[];
}

export interface GuestChange {
  name: string;
  value: string;
  note: string;
}

export interface GuestTwist extends GuestBase {
  kind: "twist";
  changes: GuestChange[];
  /** How we print it: the recipe's settings, when it has one. */
  recipe: { name: string; note: string; settings: GuestSetting[]; filaments: GuestFilament[] } | null;
}

export type GuestView = GuestIdea | GuestBuild | GuestTwist;

const HEX = /^#[0-9a-f]{6}$/i;
const color = (value: string | null | undefined) => (value && HEX.test(value) ? value.toLowerCase() : null);

/** A photo a guest may be shown: one a browser resized (an upload stored as it came may carry its EXIF). */
function guestPhoto(photo: { id: string; width: number; height: number; color: string; needsResize: boolean }) {
  if (photo.needsResize) return null;
  return {
    id: photo.id,
    width: Math.max(1, photo.width),
    height: Math.max(1, photo.height),
    color: color(photo.color),
  } satisfies GuestPhoto;
}

const onlyPhotos = <T>(list: (T | null)[]) => list.filter((photo): photo is T => photo !== null);

/** A link is shown only when it is an http(s) address the app would keep (shared/link-safety.ts). */
const safeUrl = (raw: string | null | undefined) => {
  if (!raw) return null;
  const url = checkLinkUrl(raw);
  return url && (url.protocol === "https:" || url.protocol === "http:") ? url.href : null;
};

/** "12 Nov 2026", on the workspace's clock. */
export const guestDate = (time: number) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: WORKSPACE_TIME_ZONE,
  }).format(new Date(time));

const STAGE_LABELS: Record<string, string> = {
  building: "In progress",
  done: "Done",
  shelved: "On the shelf",
};

/** A filament in words: "Bambu PLA Basic, Jade white". */
function filamentOf(filament: NonNullable<AttemptSettings["filaments"]>[number]): GuestFilament {
  const what = filament.profile?.trim() || [filament.brand, filament.type].filter(Boolean).join(" ");
  const name = [what, filament.colorName].filter(Boolean).join(", ") || "Filament";
  return { name, color: color(filament.colorHex) };
}

/** "PLA Basic jade white", with a capital: a filament a model is sliced with. */
function slicingFilament(filament: { material: string; colorHex?: string; colorName?: string; finish?: string }) {
  const words = filamentWords(filament);
  return {
    name: words.charAt(0).toUpperCase() + words.slice(1),
    color: color(filament.colorHex),
  } satisfies GuestFilament;
}

/** "Sliced in Bambu Studio": a slicer's own file says which made it ("BambuStudio 02.01.00.00", "OrcaSlicer 2.3.0"). */
function slicerLine(slicer: string | null): string {
  if (!slicer) return "";
  if (/^bambu ?studio/i.test(slicer)) return "Sliced in Bambu Studio";
  if (/^orca ?slicer/i.test(slicer)) return "Sliced in OrcaSlicer";
  return "";
}

/** The colours of a list, each checked: null for none, so the viewer falls back as the app's does. */
const colours = (list: readonly (string | null | undefined)[] | undefined) =>
  list?.length ? list.map((value) => color(value)) : undefined;

/**
 * A kept file as a guest's card shows it: a sliced model as the app's card says it (its figures, its size, who sliced
 * it, the settings row's words, its cautions), a slicer's own file by what it said. `fallback` is an attempt's own
 * filaments' colours, for a file that doesn't colour its filaments. Nothing else of the row: no settings people chose
 * and haven't sliced with, no slice it replaced, no address of the file.
 */
export function guestFile(file: AttemptFile, fallback?: readonly (string | null | undefined)[]): GuestFile {
  const base = { id: file.id, name: file.name, thumb: file.hasThumb };
  if (file.kind === "model") {
    const slice = file.slice;
    if (slice?.status !== "sliced") {
      return {
        ...base,
        lead: [],
        meta: slice ? [] : ["Not sliced yet"],
        settings: [],
        filaments: [],
        cautions: slice ? [problemSentence(slice)] : [],
        view: null,
      };
    }
    const slicing = slicingOfSlice(slice);
    const plate = slice.plate;
    const size = readSize(slice.size);
    return {
      ...base,
      lead: sliceLead(file.prefill, slice.copies),
      meta: [perPiece(file.prefill, slice.copies), sizePiece(slice), slicedBy(slice)].filter(Boolean),
      // As the card's row: which plate of a project first, then the rest of what it is sliced with. The filaments
      // are their own line (`filaments`), each with its colour, where the row names only the first.
      settings: [
        ...(plate ? [`Plate ${plate.index} of ${plate.count}`] : []),
        ...slicingSummary(slicing).filter(
          (piece) =>
            !/^Plate \d/.test(piece) &&
            !/^\+\d+ more$/.test(piece) &&
            !slicing.filaments.some((filament) => filamentWords(filament) === piece),
        ),
      ],
      filaments: slicing.filaments.map(slicingFilament),
      cautions: [
        slice.cautions?.includes("floating") ? "Parts of it float in the air." : "",
        standInSentence(slicing) ?? "",
      ].filter(Boolean),
      view:
        file.stored && slice.bytes !== 0
          ? {
              plate: file.plate,
              ...(slice.copies && slice.copies > 1 ? { copies: slice.copies } : {}),
              ...(size ? { size } : {}),
              ...(slice.colours?.length
                ? {
                    originalColors: originalFilamentColours(slice.colours).map((value) => color(value)),
                    names: printedFilamentNames(slice.colours).map((name) => name ?? null),
                  }
                : {}),
              ...(colours(fallback) ? { fallbackColors: colours(fallback) } : {}),
              bytes: slice.bytes ?? file.size,
            }
          : null,
    };
  }
  const prefill = file.prefill;
  const viewable = file.stored && (/\.gcode\.3mf$/i.test(file.name) || prefill.estimatedMinutes !== undefined);
  return {
    ...base,
    lead: sliceLead(prefill),
    meta: [file.plateCount > 1 ? `Plate ${file.plate} of ${file.plateCount}` : "", slicerLine(file.slicer)].filter(
      Boolean,
    ),
    settings: [],
    filaments: (prefill.filaments ?? []).map(filamentOf),
    cautions: [],
    view: viewable
      ? { plate: file.plate, ...(colours(fallback) ? { fallbackColors: colours(fallback) } : {}), bytes: file.size }
      : null,
  };
}

/** The settings someone else would print it with, labelled the way a person says them; a number keeps its unit. */
export function guestSettings(settings: AttemptSettings): GuestSetting[] {
  return settingRows(settings).map((row) => ({ label: row.label, value: keepUnits(row.value) }));
}

function settingRows(settings: AttemptSettings): GuestSetting[] {
  const rows: GuestSetting[] = [{ label: "Printer", value: "Bambu Lab X2D" }];
  if (settings.nozzleDiameter !== undefined || settings.nozzle === "auxiliary") {
    const size = settings.nozzleDiameter !== undefined ? `${settings.nozzleDiameter} mm` : "";
    rows.push({
      label: "Nozzle",
      value: [size, settings.nozzle === "auxiliary" ? "auxiliary" : ""].filter(Boolean).join(", "),
    });
  }
  if (settings.processPreset) rows.push({ label: "Profile", value: shortPreset(settings.processPreset) });
  if (settings.layerHeight !== undefined)
    rows.push({ label: "Layer height", value: `${settings.layerHeight.toFixed(2)} mm` });
  if (settings.infillDensity !== undefined) rows.push({ label: "Infill", value: `${settings.infillDensity}%` });
  if (settings.wallLoops !== undefined) rows.push({ label: "Walls", value: String(settings.wallLoops) });
  if (settings.supportEnabled !== undefined) {
    const kind = settings.supportType === "tree" ? "Tree" : settings.supportType === "normal" ? "Normal" : "Yes";
    rows.push({ label: "Supports", value: settings.supportEnabled ? kind : "None" });
  }
  if (settings.brim !== undefined) rows.push({ label: "Brim", value: settings.brim ? "Yes" : "No" });
  if (settings.bedType) rows.push({ label: "Plate", value: plateName(settings.bedType) });
  // One cell each, so a value never breaks over two lines of a narrow column.
  if (settings.nozzleTemperature !== undefined)
    rows.push({ label: "Nozzle temp", value: `${settings.nozzleTemperature} °C` });
  if (settings.bedTemperature !== undefined) rows.push({ label: "Bed temp", value: `${settings.bedTemperature} °C` });
  if (settings.chamberTemperature !== undefined)
    rows.push({ label: "Chamber temp", value: `${settings.chamberTemperature} °C` });
  if (settings.filamentDried !== undefined)
    rows.push({ label: "Filament dried", value: settings.filamentDried ? "Yes" : "No" });
  return rows;
}

/** What happened, in short pieces. */
function guestResults(settings: AttemptSettings): string[] {
  const results: string[] = [];
  if (settings.actualMinutes !== undefined) results.push(`Took ${formatDuration(settings.actualMinutes)}`);
  else if (settings.estimatedMinutes !== undefined) results.push(`About ${formatDuration(settings.estimatedMinutes)}`);
  if (settings.weightGrams !== undefined) results.push(`${settings.weightGrams} g of filament`);
  if (settings.failedAtPercent !== undefined) results.push(`Failed at ${settings.failedAtPercent}%`);
  if (settings.failedAtLayer !== undefined) results.push(`Failed at layer ${settings.failedAtLayer}`);
  return results.map(keepUnits);
}

/** The model's page, from the note's first model link or the draft's page, with what the draft read of it. */
function guestModel(item: Pick<Item, "note" | "draft">): GuestModel | null {
  const mark = modelOf({ note: item.note, draft: item.draft });
  if (mark?.kind !== "page") return null;
  const url = safeUrl(mark.url);
  if (!url) return null;
  const draft = item.draft && sameModel(item.draft.url, mark.url) ? item.draft : null;
  return {
    place: modelPlace(mark),
    letter: modelLetter(mark),
    url,
    title: draft?.title?.trim() || printablesTitleFromLink(url),
    designer: draft?.findings?.designer?.trim() || null,
    license: draft?.findings?.license?.trim() || null,
  };
}

const untitled = (title: string | null | undefined, note: string, fallback: string) =>
  title?.trim() || note.trim().split(/\r?\n/)[0]?.trim().slice(0, 100) || fallback;

/** An idea or a build, as a guest sees it. */
export function itemView(item: Item, custom: { failure: TagDefinition[]; success: TagDefinition[] }): GuestView {
  const model = guestModel(item);
  const note = model ? withoutModelLines(item.note, model.url) : item.note;
  const shown = onlyPhotos(item.photos.map((photo) => (guestPhoto(photo) ? photo : null)));
  const cover = bestPhoto(shown, item.attempts, item.coverPhotoId);
  // The cover first, then the thing's own photos; an attempt's photos stay with their attempt.
  const lead = onlyPhotos(
    [cover, ...shown.filter((photo) => !photo.attemptId && photo.id !== cover?.id)].map((photo) =>
      photo ? guestPhoto(photo) : null,
    ),
  );
  const base = {
    title: untitled(item.title, note, item.stage === "idea" ? "An idea" : "A build"),
    note: note.trim(),
    photos: lead,
    cover: lead[0] ?? null,
    model,
    files: (item.files ?? []).map((file) => guestFile(file)),
  };
  if (item.stage === "idea") return { kind: "idea", ...base, capturedAt: item.createdAt };

  const attempts: GuestAttempt[] = item.attempts.map((attempt, index) => {
    const number = index + 1;
    const outcomeLabel = attempt.outcome
      ? OUTCOME_LABELS[attempt.outcome]
      : attempt.endedAt
        ? "Off the bed"
        : "Printing";
    // A tag that only says the outcome again ("Spaghetti" on a spaghetti) is left out: the outcome already says it.
    const notTheOutcome = (label: string) => label.trim().toLowerCase() !== outcomeLabel.toLowerCase();
    return {
      number,
      outcome: attempt.outcome,
      outcomeLabel,
      printedAt: attempt.printedAt,
      note: attempt.note.trim(),
      photos: onlyPhotos(shown.filter((photo) => photo.attemptId === attempt.id).map(guestPhoto)),
      changes: index === 0 ? [] : attempt.changes.map((change) => keepUnits(change.text)),
      wentWrong: attempt.failureTags.map((slug) => tagLabel("failure", slug, custom.failure)).filter(notTheOutcome),
      wentWell: attempt.successNotes.map((slug) => tagLabel("success", slug, custom.success)).filter(notTheOutcome),
      settings: showsSettings({ number, outcome: attempt.outcome, changes: attempt.changes })
        ? guestSettings(attempt.settings)
        : [],
      filaments: (attempt.settings.filaments ?? []).map(filamentOf),
      results: guestResults(attempt.settings),
      printed: attemptPartsLabel(attempt, item.parts),
      file: attempt.file
        ? guestFile(
            attempt.file,
            (attempt.settings.filaments ?? []).map((filament) => filament.colorHex),
          )
        : null,
    };
  });
  const summary = summarizeBuild(item.attempts);
  const count = item.attempts.length;
  const totals = [
    summary.minutes
      ? `${summary.minutes.approximate ? "About " : ""}${formatDuration(summary.minutes.value)} printing`
      : "",
    summary.grams ? `${summary.grams.atLeast ? "At least " : ""}${summary.grams.value} g of filament` : "",
  ].filter(Boolean);
  return {
    kind: "build",
    ...base,
    stageLabel: STAGE_LABELS[item.stage] ?? "In progress",
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    attempts,
    summary: count
      ? `${count} ${count === 1 ? "attempt" : "attempts"}${summary.words ? `: ${summary.words}` : ""}`
      : "No attempts yet",
    totals,
    parts: partProgress(item.parts, item.attempts).map((progress) => ({
      name: progress.part.name,
      progress: progressLabel(progress),
      done: progress.done,
    })),
  };
}

/** Loads an idea or build the way the app does, then keeps only what a guest may see. Null when it is gone. */
export async function loadItemView(db: Db, id: string): Promise<GuestView | null> {
  const [item, custom] = await Promise.all([
    loadItem(db, id),
    db.select({ kind: tags.kind, slug: tags.slug, label: tags.label }).from(tags),
  ]);
  if (!item) return null;
  const pick = (kind: "failure" | "success") =>
    custom.filter((tag) => tag.kind === kind).map((tag) => ({ slug: tag.slug, label: tag.label }) as TagDefinition);
  const view = itemView(item, { failure: pick("failure"), success: pick("success") });
  return withPageTitle(db, view);
}

/** The model's card takes the page's own title first, as the app's LinkCard does (link previews). */
async function withPageTitle<V extends GuestView>(db: Db, view: V): Promise<V> {
  if (!view.model) return view;
  const row = await db
    .select({ title: linkPreviews.title })
    .from(linkPreviews)
    .where(and(eq(linkPreviews.url, view.model.url), eq(linkPreviews.failed, false)))
    .get();
  const title = row?.title?.trim();
  return title ? { ...view, model: { ...view.model, title } } : view;
}

/** A twist, as a guest sees it: its source, what we changed and how we print it. */
export async function loadTwistView(db: Db, id: string): Promise<GuestTwist | null> {
  const twist = await db
    .select()
    .from(twists)
    .where(and(eq(twists.id, id), isNull(twists.deletedAt)))
    .get();
  if (!twist) return null;
  const [photo, recipe, model] = await Promise.all([
    twist.sourcePhotoId
      ? db
          .select({
            id: photos.id,
            width: photos.width,
            height: photos.height,
            color: photos.color,
            needsResize: photos.needsResize,
          })
          .from(photos)
          .innerJoin(items, eq(items.id, photos.itemId))
          .where(and(eq(photos.id, twist.sourcePhotoId), isNull(photos.deletedAt), isNull(items.deletedAt)))
          .get()
      : undefined,
    twist.recipeId
      ? db
          .select()
          .from(recipes)
          .where(and(eq(recipes.id, twist.recipeId), isNull(recipes.deletedAt)))
          .get()
      : undefined,
    // Its model (the newest, as the twist page shows it).
    db
      .select()
      .from(twistFiles)
      .where(and(eq(twistFiles.twistId, twist.id), isNull(twistFiles.deletedAt)))
      .orderBy(desc(twistFiles.createdAt))
      .get(),
  ]);
  const lead = photo ? guestPhoto(photo) : null;
  const sourceUrl = safeUrl(twist.sourceUrl);
  const mark = sourceUrl ? modelMarkOf(sourceUrl) : null;
  let host: string | null = null;
  if (sourceUrl) host = new URL(sourceUrl).hostname.replace(/^www\./, "");
  // Named as the app's twist page names it (LinkCard): the page's own title, never the idea it was made from
  // (source_title keeps that).
  return withPageTitle(db, {
    kind: "twist",
    title: twist.name.trim() || "A twist",
    note: twist.note.trim(),
    photos: lead ? [lead] : [],
    cover: lead,
    model: sourceUrl
      ? {
          place: mark ? modelPlace(mark) : (host ?? "The source"),
          letter: mark ? modelLetter(mark) : (host ?? "?").charAt(0).toUpperCase(),
          url: sourceUrl,
          title: printablesTitleFromLink(sourceUrl),
          designer: twist.designer?.trim() || null,
          license: twist.license?.trim() || null,
        }
      : null,
    files: model ? [guestFile(toApiFile(model))] : [],
    changes: twist.changes.map((change) => ({
      name: changeName(change),
      value: change.value.trim(),
      note: change.note.trim(),
    })),
    recipe: recipe
      ? {
          name: recipe.name.trim(),
          note: recipe.note.trim(),
          settings: guestSettings(recipe.settings),
          filaments: (recipe.settings.filaments ?? []).map(filamentOf),
        }
      : null,
  });
}

/** The ids of the files whose cards the page shows: a guest may fetch their pictures and toolpaths, nothing else. */
export function fileIdsOf(view: GuestView): Map<string, GuestFile> {
  const files = new Map(view.files.map((file) => [file.id, file]));
  if (view.kind === "build")
    for (const attempt of view.attempts) if (attempt.file) files.set(attempt.file.id, attempt.file);
  return files;
}

/** The ids of the photos a guest of this view may fetch: exactly the ones on its page. */
export function photoIdsOf(view: GuestView): Set<string> {
  const ids = new Set(view.photos.map((photo) => photo.id));
  if (view.kind === "build") for (const attempt of view.attempts) for (const photo of attempt.photos) ids.add(photo.id);
  return ids;
}
