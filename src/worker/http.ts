import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Item as ApiItem, Photo as ApiPhoto, Person } from "../shared/api.ts";
import type { Item, Photo, User } from "./db/schema.ts";

export function apiError(c: Context, status: ContentfulStatusCode, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

export function toPerson(user: User): Person {
  return { id: user.id, username: user.username, name: user.name, color: user.color };
}

export function toApiPhoto(photo: Photo): ApiPhoto {
  return {
    id: photo.id,
    itemId: photo.itemId,
    position: photo.position,
    width: photo.width,
    height: photo.height,
    color: photo.color,
    takenAt: photo.takenAt?.getTime() ?? null,
    createdBy: photo.createdBy,
    createdAt: photo.createdAt.getTime(),
  };
}

export function toApiItem(item: Item, itemPhotos: Photo[]): ApiItem {
  return {
    id: item.id,
    stage: item.stage,
    title: item.title,
    note: item.note,
    createdBy: item.createdBy,
    createdAt: item.createdAt.getTime(),
    updatedAt: item.updatedAt.getTime(),
    photos: itemPhotos.map(toApiPhoto),
  };
}
