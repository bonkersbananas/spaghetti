import type { AttemptSettings, Outcome, SettingChange, TagKind } from "./attempts.ts";
import type { JournalKind, JournalSummary } from "./journal.ts";
import type { PersonColor } from "./people.ts";

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
  /** The one-line note. */
  note: string;
  /** Slugs of failure tags (built in or people's own). */
  failureTags: string[];
  /** Slugs of success notes. */
  successNotes: string[];
  settings: AttemptSettings;
  /** What changed since the attempt before it; empty for the first. */
  changes: SettingChange[];
  createdBy: string;
  /** Who gave it its outcome; null while printing, and for attempts finished before this was kept. */
  finishedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

/** An idea, and the build it grows into: one record that moves through stages. Titles are optional. */
export interface Item {
  id: string;
  stage: ItemStage;
  title: string | null;
  note: string;
  /** The person who captured it. */
  createdBy: string;
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

/** An attempt without "what changed" (search results and suggestions show it on its own). */
export type AttemptSummary = Omit<Attempt, "changes">;

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

/** PUT /api/items/:id/photos/order */
export interface ReorderPhotosRequest {
  photoIds: string[];
}

export type PhotoVariant = "large" | "thumb";
export const PHOTO_VARIANTS: readonly PhotoVariant[] = ["large", "thumb"];
/** Most the Worker accepts for one variant. The browser's large WebP is far smaller. */
export const MAX_PHOTO_BYTES = 12 * 1024 * 1024;
export const PHOTO_CONTENT_TYPES = ["image/webp", "image/jpeg"] as const;

export function photoUrl(id: string, variant: PhotoVariant): string {
  return `/api/photos/${id}/${variant}`;
}
