import { and, asc, eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Hono } from "hono";
import { z } from "zod";
import { WISHLIST_MAX, type Wishlist, type WishlistResponse, type WishlistsResponse } from "../../shared/wishlist.ts";
import { recordChange } from "../changes.ts";
import type { Db } from "../db/index.ts";
import { items, users, wishlistEntries } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";

const addToWishlist = z
  .object({
    /** A place on the list (1 is the top), for the undo of taking one off; the end without it. */
    position: z.number().int().min(1).max(WISHLIST_MAX).optional(),
  })
  .strict();
const wishlistOrder = z.object({ ids: z.array(z.string().min(1).max(64)).max(WISHLIST_MAX * 4) }).strict();
const updateWishlist = z.object({ private: z.boolean() }).strict();

type Batch = [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];

interface Row {
  itemId: string;
  position: number;
  addedAt: Date;
  /** Still an idea that isn't deleted: only those show. */
  live: boolean;
}

/** One person's entries, top first, the hidden ones (deleted, or a build now) kept in their slots. */
async function loadRows(db: Db, userId: string): Promise<Row[]> {
  const rows = await db
    .select({
      itemId: wishlistEntries.itemId,
      position: wishlistEntries.position,
      addedAt: wishlistEntries.addedAt,
      stage: items.stage,
      deletedAt: items.deletedAt,
    })
    .from(wishlistEntries)
    .innerJoin(items, eq(items.id, wishlistEntries.itemId))
    .where(eq(wishlistEntries.userId, userId))
    .orderBy(asc(wishlistEntries.position), asc(wishlistEntries.addedAt));
  return rows.map((row) => ({ ...row, live: row.stage === "idea" && !row.deletedAt }));
}

function toWishlist(personId: string, isPrivate: boolean, rows: Row[]): Wishlist {
  return {
    personId,
    private: isPrivate,
    entries: rows
      .filter((row) => row.live)
      .map((row, index) => ({ itemId: row.itemId, position: index + 1, addedAt: row.addedAt.getTime() })),
  };
}

async function loadMine(db: Db, userId: string): Promise<Wishlist> {
  const [person, rows] = await Promise.all([
    db.select({ wishlistPrivate: users.wishlistPrivate }).from(users).where(eq(users.id, userId)).get(),
    loadRows(db, userId),
  ]);
  return toWishlist(userId, person?.wishlistPrivate ?? false, rows);
}

/** Numbers the whole list 1, 2, 3… in this order. */
const renumber = (db: Db, userId: string, ids: string[]) =>
  ids.map((itemId, index) =>
    db
      .update(wishlistEntries)
      .set({ position: index + 1 })
      .where(and(eq(wishlistEntries.userId, userId), eq(wishlistEntries.itemId, itemId))),
  );

/**
 * /api/wishlists. Everyone reads everyone's (a private one comes back empty, saying so); only
 * a person changes their own (`/me/…`; not open to agent tokens). Each write records a
 * `wishlist` change with the owner's id and no item, so the feed never says what a private
 * list holds.
 */
export const wishlistRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const db = c.var.db;
    const me = c.var.user.id;
    const people = await db
      .select({ id: users.id, wishlistPrivate: users.wishlistPrivate })
      .from(users)
      .orderBy(asc(users.createdAt));
    const wishlists = await Promise.all(
      people.map(async (person) => {
        if (person.id !== me && person.wishlistPrivate) return toWishlist(person.id, true, []);
        return toWishlist(person.id, person.wishlistPrivate, await loadRows(db, person.id));
      }),
    );
    wishlists.sort((a, b) => Number(b.personId === me) - Number(a.personId === me));
    return c.json<WishlistsResponse>({ wishlists });
  })

  /** Adds an idea (at the end, or at `position`). Adding one that is already there changes nothing. */
  .put("/me/items/:itemId", async (c) => {
    const parsed = addToWishlist.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return apiError(c, 400, "invalid", "That couldn't be read.");
    const db = c.var.db;
    const me = c.var.user.id;
    const itemId = c.req.param("itemId");
    const item = await db
      .select({ stage: items.stage, deletedAt: items.deletedAt })
      .from(items)
      .where(eq(items.id, itemId))
      .get();
    if (!item || item.deletedAt) return apiError(c, 404, "not_found", "That idea isn't here any more.");
    const rows = await loadRows(db, me);
    if (rows.some((row) => row.itemId === itemId))
      return c.json<WishlistResponse>({ wishlist: await loadMine(db, me) });
    if (item.stage !== "idea")
      return apiError(c, 409, "not_an_idea", "Only ideas go on a wishlist; that one is a build now.");
    const live = rows.filter((row) => row.live);
    if (live.length >= WISHLIST_MAX) {
      return apiError(c, 409, "full", `A wishlist holds ${WISHLIST_MAX} ideas. Take one off first.`);
    }
    // At `position` among the ones that show: before the one there now, hidden entries keep their slots.
    const ids = rows.map((row) => row.itemId);
    const anchor = parsed.data.position ? live[parsed.data.position - 1] : undefined;
    const at = anchor ? ids.indexOf(anchor.itemId) : ids.length;
    ids.splice(at, 0, itemId);
    await db.batch([
      db
        .insert(wishlistEntries)
        .values({ userId: me, itemId, position: at + 1, addedAt: new Date() })
        .onConflictDoNothing(),
      recordChange(db, { entity: "wishlist", id: me, action: "created", actor: c.var.actor }),
      ...renumber(db, me, ids),
    ] as Batch);
    return c.json<WishlistResponse>({ wishlist: await loadMine(db, me) });
  })

  .delete("/me/items/:itemId", async (c) => {
    const db = c.var.db;
    const me = c.var.user.id;
    await db.batch([
      db
        .delete(wishlistEntries)
        .where(and(eq(wishlistEntries.userId, me), eq(wishlistEntries.itemId, c.req.param("itemId")))),
      recordChange(db, { entity: "wishlist", id: me, action: "deleted", actor: c.var.actor }),
    ]);
    return c.json<WishlistResponse>({ wishlist: await loadMine(db, me) });
  })

  /**
   * The order of the ideas that show: these first, in this order; any not mentioned keep their
   * turn after them. Hidden entries keep their slots, so they come back where they were.
   */
  .put("/me/order", async (c) => {
    const parsed = wishlistOrder.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That order couldn't be read.");
    const db = c.var.db;
    const me = c.var.user.id;
    const rows = await loadRows(db, me);
    const live = rows.filter((row) => row.live).map((row) => row.itemId);
    const known = new Set(live);
    const given = [...new Set(parsed.data.ids.filter((id) => known.has(id)))];
    const order = [...given, ...live.filter((id) => !given.includes(id))];
    let next = 0;
    const ids = rows.map((row) => (row.live ? (order[next++] as string) : row.itemId));
    if (ids.length) {
      await db.batch([
        ...renumber(db, me, ids),
        recordChange(db, { entity: "wishlist", id: me, action: "updated", actor: c.var.actor }),
      ] as Batch);
    }
    return c.json<WishlistResponse>({ wishlist: await loadMine(db, me) });
  })

  /** Shares your list with the others who sign in (the default) or keeps it to yourself. */
  .patch("/me", async (c) => {
    const parsed = updateWishlist.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That couldn't be read.");
    const db = c.var.db;
    const me = c.var.user.id;
    await db.batch([
      db.update(users).set({ wishlistPrivate: parsed.data.private }).where(eq(users.id, me)),
      recordChange(db, { entity: "wishlist", id: me, action: "updated", actor: c.var.actor }),
    ]);
    return c.json<WishlistResponse>({ wishlist: await loadMine(db, me) });
  });

export { addToWishlist, updateWishlist, wishlistOrder };
