import type { AttemptSettings, Outcome, SettingChange, TagKind } from "./attempts.ts";
import type { BridgeStatus } from "./bridge.ts";
import type { JournalKind, JournalSummary } from "./journal.ts";
import type { PersonColor } from "./people.ts";
import type { PrinterSetup, Remaining } from "./spools.ts";

/** A person as the client sees them: never includes credentials. */
export interface Person {
  id: string;
  username: string;
  name: string;
  color: PersonColor;
}

export interface SessionResponse {
  user: Person;
}

export interface PeopleResponse {
  people: Person[];
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export type ItemStage = "idea" | "building" | "done" | "shelved";

/** A photo of an item. Its pixels are at /api/photos/<id>/large and /thumb. */
export interface Photo {
  id: string;
  itemId: string;
  position: number;
  width: number;
  height: number;
  /** Average color (#rrggbb), the placeholder while it loads. */
  color: string;
  /** Epoch ms from the photo's EXIF data, when there was any. */
  takenAt: number | null;
  /** The print attempt it shows, or null for the item's own photos. */
  attemptId: string | null;
  /**
   * Arrived without a browser to resize it: stored at full size with a placeholder color until a signed-in
   * browser resizes it and uploads the real variants (`lib/photo-resize.ts`).
   */
  needsResize: boolean;
  createdBy: string;
  createdAt: number;
}

/**
 * One go at printing a build. Printing while `outcome` is null; finished with
 * an outcome, now or later.
 */
export interface Attempt {
  id: string;
  itemId: string;
  outcome: Outcome | null;
  /** When it was printed (or started printing), epoch ms. */
  printedAt: number;
  /** When an outcome was given. */
  finishedAt: number | null;
  /**
   * When the print stopped on the printer, told by the printer bridge. With no `outcome` yet it is a print that
   * is off the bed and waiting for someone to say how it went.
   */
  endedAt: number | null;
  /** A failure tag the printer suggests (a failed or cancelled print, spaghetti seen). A suggestion, not a verdict. */
  suggestedFailureTag: string | null;
  /** The one-line note. */
  note: string;
  /** Slugs of failure tags (built in or people's own). */
  failureTags: string[];
  /** Slugs of success notes. */
  successNotes: string[];
  settings: AttemptSettings;
  /** What changed since the attempt before it; empty for the first. */
  changes: SettingChange[];
  /** The slicer file it was printed from, if one was added. */
  file: AttemptFile | null;
  createdBy: string;
  /** The agent it was logged through ("via Claude for Alex"), if any; `createdBy` is then its owner. */
  createdVia: string | null;
  /** Who gave it its outcome; null while printing, and for attempts finished before this was kept. */
  finishedBy: string | null;
  /** The agent that finished it, if any. */
  finishedVia: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * A slicer file (.3mf or .gcode.3mf) on an attempt. Read in the browser; the
 * Worker only keeps the bytes (at /api/files/<id>, when `stored`) and the
 * plate's thumbnail (/api/files/<id>/thumb, when `hasThumb`).
 */
export interface AttemptFile {
  id: string;
  name: string;
  /** Bytes. */
  size: number;
  /** False when it was over MAX_SLICER_FILE_BYTES: only what it said is kept. */
  stored: boolean;
  hasThumb: boolean;
  /** The plate printed, from 1, of `plateCount`. */
  plate: number;
  plateCount: number;
  slicer: string | null;
  /** The settings read from the file: values still equal to these show as "from the file". */
  prefill: AttemptSettings;
  createdAt: number;
}

/** The largest slicer file kept with an attempt. Above it, only what the file said is saved. */
export const MAX_SLICER_FILE_BYTES = 25 * 1024 * 1024;
/** Plate thumbnails are small PNGs; this is generous. */
export const MAX_FILE_THUMB_BYTES = 4 * 1024 * 1024;

export function fileUrl(id: string, part: "file" | "thumb" = "file"): string {
  return part === "file" ? `/api/files/${id}` : `/api/files/${id}/thumb`;
}

/** An idea, and the build it grows into: one record that moves through stages. Titles are optional. */
export interface Item {
  id: string;
  stage: ItemStage;
  title: string | null;
  note: string;
  /** The person who captured it. */
  createdBy: string;
  /** The agent it was captured through ("via Claude for Alex"), if any; `createdBy` is then its owner. */
  createdVia: string | null;
  createdAt: number;
  updatedAt: number;
  /** When it became a build. */
  startedAt: number | null;
  /** When it was marked done or shelved. */
  finishedAt: number | null;
  /** The final photo, picked when a build is finished. */
  coverPhotoId: string | null;
  /** In order: the first is the cover. Includes the attempts' photos (they have an attemptId). */
  photos: Photo[];
  /** Oldest first: the first is attempt 1. Always empty for ideas. */
  attempts: Attempt[];
}

export interface ItemsResponse {
  items: Item[];
}

export interface ItemResponse {
  item: Item;
}

export interface PhotoResponse {
  photo: Photo;
}

/** POST /api/items. The client picks the id so captures can be retried safely. */
export interface CreateItemRequest {
  id: string;
  title?: string | null;
  note?: string;
  /** When it was captured (epoch ms), which can be before an offline upload. */
  createdAt?: number;
  /** "building" for a build started from scratch. */
  stage?: "idea" | "building";
}

/** PATCH /api/items/:id */
export interface UpdateItemRequest {
  title?: string | null;
  note?: string;
  /** Moves an idea to a build, finishes or shelves it, or takes that back. */
  stage?: ItemStage;
  /** One of the item's photos, or null. */
  coverPhotoId?: string | null;
}

/**
 * POST /api/items/:id/attempts. The client picks the id. Without `settings`,
 * the attempt starts from the previous attempt's ("same as last time").
 * Logging an attempt on an idea makes it a build.
 */
export interface CreateAttemptRequest {
  id: string;
  /** Left out or null: still printing. */
  outcome?: Outcome | null;
  printedAt?: number;
  note?: string;
  failureTags?: string[];
  successNotes?: string[];
  settings?: AttemptSettings;
}

/** PATCH /api/attempts/:id. `settings` replaces the whole object. */
export interface UpdateAttemptRequest {
  outcome?: Outcome | null;
  printedAt?: number;
  /** The printer bridge's: when the print stopped, and the failure tag it suggests (null clears them). */
  endedAt?: number | null;
  suggestedFailureTag?: string | null;
  note?: string;
  failureTags?: string[];
  successNotes?: string[];
  settings?: AttemptSettings;
}

export interface AttemptResponse {
  attempt: Attempt;
}

/**
 * POST /api/attempts/:id/finish: how a print finished away from a connection
 * reaches the server (queued on the device). Safe to repeat. If the attempt is
 * still printing it is finished with this outcome, the note is added to its
 * line and the tags set. If someone else finished it first, their outcome
 * stands and only the note is added (`finished` is false); photos are
 * uploaded separately either way.
 */
export interface FinishAttemptRequest {
  outcome: Outcome;
  /** When it came off the bed, epoch ms (never later than now). */
  finishedAt?: number;
  note?: string;
  failureTags?: string[];
  successNotes?: string[];
}

export interface FinishAttemptResponse {
  attempt: Attempt;
  /** False when someone else had already given it an outcome that differs from this one. */
  finished: boolean;
}

/** A failure tag or success note someone added; the built-in ones live in shared/attempts.ts. */
export interface Tag {
  kind: TagKind;
  slug: string;
  label: string;
}

export interface TagsResponse {
  tags: Tag[];
}

/** POST /api/tags. The slug is made from the label; adding one that exists returns it. */
export interface CreateTagRequest {
  kind: TagKind;
  label: string;
}

export interface TagResponse {
  tag: Tag;
}

/** One thing that happened, in the journal. */
export interface JournalEntry {
  /** Unique within the journal: "attempt:<id>", "finished:<item id>"… */
  key: string;
  kind: JournalKind;
  itemId: string;
  /** For kind "attempt". */
  attemptId: string | null;
  /** When it happened, epoch ms. */
  at: number;
  /** Who logged the attempt or captured the item. */
  by: string;
  /** The agent it was made through, if any. */
  via: string | null;
}

/**
 * GET /api/journal?outcome=&material=&person=&cursor=. Newest first, a page at
 * a time; `items` holds every item the entries mention, with their attempts
 * and photos.
 */
export interface JournalResponse {
  entries: JournalEntry[];
  items: Item[];
  /** Pass as `cursor` for the next page; null at the end. */
  next: string | null;
}

/** GET /api/journal/summary?from=&to= (epoch ms, the month in local time). */
export interface JournalSummaryResponse {
  summary: JournalSummary;
}

/** What has been used and tagged, most often first: filter chips and search suggestions. */
export interface FacetsResponse {
  /** Filament types, uppercase ("PLA", "PETG"). */
  materials: Array<{ value: string; count: number }>;
  tags: Array<{ kind: TagKind; slug: string; count: number }>;
}

/** An attempt without "what changed" or its file (search results and suggestions show it on its own). */
export type AttemptSummary = Omit<Attempt, "changes" | "file">;

/** An attempt found by search or offered as "what worked last time". */
export interface AttemptHit {
  attempt: AttemptSummary;
  /** Its number in its build: 1 for the first. */
  number: number;
  item: { id: string; title: string | null; stage: ItemStage };
  /** The attempt's first photo, else its build's. */
  photo: Photo | null;
}

/** An idea or a build found by search. */
export interface ItemHit {
  item: Pick<Item, "id" | "stage" | "title" | "note" | "createdBy" | "createdAt" | "startedAt" | "finishedAt">;
  /** How many attempts it has, and how the last one went. */
  attempts: number;
  lastOutcome: Outcome | null;
  /** The part of a long note that matched, with SNIPPET_OPEN/CLOSE around matched words. */
  snippet: string | null;
  photo: Photo | null;
}

/** GET /api/search?q=&outcome=&material=&tag=&person= */
export interface SearchResponse {
  builds: ItemHit[];
  ideas: ItemHit[];
  attempts: AttemptHit[];
}

/**
 * GET /api/what-worked?item=&material=: the latest attempts that worked with
 * this material, the build's own first.
 */
export interface WhatWorkedResponse {
  matches: Array<AttemptHit & { sameBuild: boolean }>;
}

/** A spool on the shelf. */
export interface Spool {
  id: string;
  material: string;
  brand: string | null;
  colorName: string | null;
  /** #rrggbb */
  colorHex: string | null;
  finish: string | null;
  remaining: Remaining;
  note: string;
  /** When it was last dried, epoch ms. */
  driedAt: number | null;
  /** Its photo (usually the label), at /api/photos/<id>/large and /thumb. */
  photo: { id: string; width: number; height: number; color: string } | null;
  /** Where it is loaded: "A1" to "D4", "Ext", or null. */
  slot: string | null;
  /** The RFID tray UUID of a Bambu spool, as the AMS reports it; the printer bridge finds the spool by it. */
  trayUuid: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface SpoolsResponse {
  spools: Spool[];
}

export interface SpoolResponse {
  spool: Spool;
}

/** POST /api/spools. The client picks the id; a retry gets the same spool back. */
export interface CreateSpoolRequest {
  id: string;
  material: string;
  brand?: string | null;
  colorName?: string | null;
  colorHex?: string | null;
  finish?: string | null;
  remaining?: Remaining;
  note?: string;
  driedAt?: number | null;
  trayUuid?: string | null;
  createdAt?: number;
}

/** PATCH /api/spools/:id */
export type UpdateSpoolRequest = Partial<Omit<CreateSpoolRequest, "id" | "createdAt">>;

/** GET /api/spools/:id/attempts: what was printed with it, newest first. */
export interface SpoolAttemptsResponse {
  attempts: AttemptHit[];
}

/** PUT /api/printer: any part of the setup; what is left out stays as it is. */
export interface UpdatePrinterRequest {
  nozzles?: Partial<PrinterSetup["nozzles"]>;
  plates?: string[];
  amsUnits?: number;
}

/** GET /api/printer: how the printer is set up, and what is loaded where (slot → spool id). */
export interface PrinterResponse {
  setup: PrinterSetup;
  slots: Record<string, string>;
  /** What the printer bridge last said; null while none has ever been set up. */
  bridge: BridgeStatus | null;
}

/**
 * PUT /api/printer/bridge: what the printer bridge sends (heartbeat, progress, trays it couldn't match). Whatever is
 * left out stays as it was; `progress: null` says there is no print going.
 */
export interface UpdateBridgeRequest {
  printerState?: BridgeStatus["printerState"];
  progress?: {
    attemptId: string;
    percent: number;
    remainingMinutes?: number | null;
    layer?: number | null;
    totalLayers?: number | null;
  } | null;
  unknownTrays?: BridgeStatus["unknownTrays"];
}

/** PUT /api/printer/slots/:slot. Loading a spool takes it out of the slot it was in. */
export interface SetSlotRequest {
  spoolId: string | null;
}

/** PUT /api/items/:id/photos/order */
export interface ReorderPhotosRequest {
  photoIds: string[];
}

export type PhotoVariant = "large" | "thumb";
export const PHOTO_VARIANTS: readonly PhotoVariant[] = ["large", "thumb"];
/** Most the Worker accepts for one variant. The browser's large WebP is far smaller. */
/** POST /api/photos/:id/resize-claim: whether this browser now has the job of resizing the photo. */
export interface ResizeClaimResponse {
  claimed: boolean;
}

export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
export const PHOTO_CONTENT_TYPES = ["image/webp", "image/jpeg"] as const;

export function photoUrl(id: string, variant: PhotoVariant): string {
  return `/api/photos/${id}/${variant}`;
}
