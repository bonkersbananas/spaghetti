import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { Hono } from "hono";
import { z } from "zod";
import type { ShoppingItem, ShoppingItemResponse, ShoppingItemsResponse } from "../../shared/api.ts";
import {
  isWebLink,
  SHOPPING_ITEMS_MAX,
  SHOPPING_LINK_MAX,
  SHOPPING_NAME_MAX,
  splitShopping,
} from "../../shared/shopping.ts";
import { recordChange } from "../changes.ts";
import type { Db } from "../db/index.ts";
import { type ShoppingItemRow, shoppingItems } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";

const name = z.string().trim().max(SHOPPING_NAME_MAX);
const link = z
  .string()
  .trim()
  .max(SHOPPING_LINK_MAX)
  .refine((value) => isWebLink(value), "An http(s) address.");
/** An empty string clears a link, like null. */
const linkChange = z.union([link, z.literal(""), z.null()]).transform((value) => value || null);

/** What POST /api/shopping-items accepts. The client picks the id, so a retried request is safe. */
const createShoppingItem = z
  .object({ id: z.uuid(), name: name.optional(), link: link.optional(), priceLink: link.optional() })
  .refine((body) => !!body.name || !!body.link || !!body.priceLink, "A name or a link.");
const updateShoppingItem = z.object({
  name: name.optional(),
  link: linkChange.optional(),
  priceLink: linkChange.optional(),
  /** Ticked off (now, by whoever asks) or back on the list. */
  bought: z.boolean().optional(),
});
const shoppingOrder = z.object({ ids: z.array(z.uuid()).max(SHOPPING_ITEMS_MAX) });

const notFound = "That isn't on the list any more.";

function toApi(row: ShoppingItemRow): ShoppingItem {
  return {
    id: row.id,
    name: row.name,
    link: row.link,
    priceLink: row.priceLink,
    position: row.position,
    boughtAt: row.boughtAt?.getTime() ?? null,
    boughtBy: row.boughtBy,
    createdBy: row.createdBy,
    createdVia: row.createdVia,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/** The whole list: what's still to buy in its order, then what was bought, the latest first. */
async function liveList(db: Db): Promise<ShoppingItem[]> {
  const rows = await db
    .select()
    .from(shoppingItems)
    .where(isNull(shoppingItems.deletedAt))
    .orderBy(asc(shoppingItems.position), desc(shoppingItems.createdAt));
  const { toBuy, bought } = splitShopping(rows.map(toApi));
  return [...toBuy, ...bought];
}

async function loadOne(db: Db, id: string): Promise<ShoppingItem | null> {
  const row = await db
    .select()
    .from(shoppingItems)
    .where(and(eq(shoppingItems.id, id), isNull(shoppingItems.deletedAt)))
    .get();
  return row ? toApi(row) : null;
}

/** /api/shopping-items: things to buy for the printer, shared by both people. */
export const shoppingItemsRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json<ShoppingItemsResponse>({ shoppingItems: await liveList(c.var.db) }))

  /** Adds something at the top of what's still to buy. Sending the same id again changes nothing. */
  .post("/", async (c) => {
    const parsed = createShoppingItem.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That couldn't be read. It needs a name or a link.");
    const body = parsed.data;
    const db = c.var.db;

    const existing = await db.select().from(shoppingItems).where(eq(shoppingItems.id, body.id)).get();
    if (existing) {
      if (existing.deletedAt) return apiError(c, 409, "deleted", "That was taken off the list.");
      return c.json<ShoppingItemResponse>({ shoppingItem: toApi(existing) }, 201);
    }
    const [{ count } = { count: 0 }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(shoppingItems)
      .where(isNull(shoppingItems.deletedAt));
    if (count >= SHOPPING_ITEMS_MAX) {
      return apiError(c, 422, "too_many", "The list is full. Take a few things off it first.");
    }

    const now = new Date();
    await db.batch([
      db
        .insert(shoppingItems)
        .values({
          id: body.id,
          name: body.name ?? "",
          link: body.link ?? null,
          priceLink: body.priceLink ?? null,
          // The top of the list: one before the smallest place in use.
          position: sql<number>`(SELECT coalesce(min(position), 1) - 1 FROM shopping_items WHERE deleted_at IS NULL)`,
          createdBy: c.var.user.id,
          createdVia: c.var.via,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing(),
      recordChange(db, { entity: "shopping", id: body.id, action: "created", actor: c.var.actor }),
    ]);
    const shoppingItem = await loadOne(db, body.id);
    if (!shoppingItem) return apiError(c, 409, "deleted", "That was taken off the list.");
    return c.json<ShoppingItemResponse>({ shoppingItem }, 201);
  })

  /** The order of what's still to buy: these first, in this order; anything not mentioned keeps its turn after them. */
  .put("/order", async (c) => {
    const parsed = shoppingOrder.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That order couldn't be read.");
    const db = c.var.db;
    const listed = await db
      .select({ id: shoppingItems.id })
      .from(shoppingItems)
      .where(and(isNull(shoppingItems.deletedAt), isNull(shoppingItems.boughtAt)))
      .orderBy(asc(shoppingItems.position), desc(shoppingItems.createdAt));
    const known = new Set(listed.map((row) => row.id));
    const order = [
      ...new Set(parsed.data.ids.filter((itemId) => known.has(itemId))),
      ...listed.map((row) => row.id).filter((itemId) => !parsed.data.ids.includes(itemId)),
    ];
    if (order.length) {
      const now = new Date();
      await db.batch([
        ...order.map((itemId, index) =>
          db
            .update(shoppingItems)
            .set({ position: index + 1, updatedAt: now })
            .where(eq(shoppingItems.id, itemId)),
        ),
        recordChange(db, { entity: "shopping", id: order[0] as string, action: "updated", actor: c.var.actor }),
      ] as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
    }
    return c.json<ShoppingItemsResponse>({ shoppingItems: await liveList(db) });
  })

  .patch("/:id", async (c) => {
    const parsed = updateShoppingItem.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That change couldn't be read.");
    const { bought, ...fields } = parsed.data;
    const itemId = c.req.param("id");
    const db = c.var.db;
    const now = new Date();
    const [[row]] = await db.batch([
      db
        .update(shoppingItems)
        .set({
          ...fields,
          ...(bought === true && {
            // Ticking off something already ticked keeps who bought it and when.
            boughtAt: sql`coalesce(${shoppingItems.boughtAt}, ${now.getTime()})`,
            boughtBy: sql`coalesce(${shoppingItems.boughtBy}, ${c.var.user.id})`,
          }),
          // Back on the list, at the top: it's needed again now.
          ...(bought === false && {
            boughtAt: null,
            boughtBy: null,
            position: sql<number>`CASE WHEN ${shoppingItems.boughtAt} IS NULL THEN ${shoppingItems.position}
              ELSE (SELECT coalesce(min(position), 1) - 1 FROM shopping_items WHERE deleted_at IS NULL AND bought_at IS NULL) END`,
          }),
          updatedAt: now,
        })
        .where(and(eq(shoppingItems.id, itemId), isNull(shoppingItems.deletedAt)))
        .returning({ id: shoppingItems.id }),
      recordChange(db, { entity: "shopping", id: itemId, action: "updated", actor: c.var.actor }),
    ]);
    if (!row) return apiError(c, 404, "not_found", notFound);
    const shoppingItem = await loadOne(db, itemId);
    if (!shoppingItem) return apiError(c, 404, "not_found", notFound);
    return c.json<ShoppingItemResponse>({ shoppingItem });
  })

  .delete("/:id", async (c) => {
    const itemId = c.req.param("id");
    const [[row]] = await c.var.db.batch([
      c.var.db
        .update(shoppingItems)
        .set({ deletedAt: new Date() })
        .where(and(eq(shoppingItems.id, itemId), isNull(shoppingItems.deletedAt)))
        .returning({ id: shoppingItems.id }),
      recordChange(c.var.db, { entity: "shopping", id: itemId, action: "deleted", actor: c.var.actor }),
    ]);
    if (!row) return apiError(c, 404, "not_found", notFound);
    return c.body(null, 204);
  })

  /** The undo of a delete: it comes back where it was. */
  .post("/:id/restore", async (c) => {
    const itemId = c.req.param("id");
    await c.var.db.batch([
      c.var.db
        .update(shoppingItems)
        .set({ deletedAt: null })
        .where(and(eq(shoppingItems.id, itemId), isNotNull(shoppingItems.deletedAt))),
      recordChange(c.var.db, { entity: "shopping", id: itemId, action: "restored", actor: c.var.actor }),
    ]);
    const shoppingItem = await loadOne(c.var.db, itemId);
    if (!shoppingItem) return apiError(c, 404, "not_found", "That's gone for good.");
    return c.json<ShoppingItemResponse>({ shoppingItem });
  });

/** For the OpenAPI document (worker/openapi). */
export { createShoppingItem, shoppingOrder, updateShoppingItem };
