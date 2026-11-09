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
  createdBy: string;
  createdAt: number;
}

/** An idea (phase 2), later a build. Titles are optional. */
export interface Item {
  id: string;
  stage: ItemStage;
  title: string | null;
  note: string;
  /** The person who captured it. */
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  /** In order: the first is the cover. */
  photos: Photo[];
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
}

/** PATCH /api/items/:id */
export interface UpdateItemRequest {
  title?: string | null;
  note?: string;
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
