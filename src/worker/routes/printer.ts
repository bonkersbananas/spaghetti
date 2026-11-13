import { and, desc, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { PrinterResponse } from "../../shared/api.ts";
import { BRIDGE_PROBLEM_CODES, type BridgeStatusData } from "../../shared/bridge.ts";
import { DEFAULT_PRINTER, type PrinterSetup, SLOT_PATTERN, X2D } from "../../shared/spools.ts";
import { recordChange } from "../changes.ts";
import type { Db } from "../db/index.ts";
import { amsSlots, attempts, bridge, bridgePairings, printer, spools } from "../db/schema.ts";
import type { AppEnv } from "../env.ts";
import { apiError } from "../http.ts";
import { slicingDefaults } from "../slicing-schema.ts";
import { disconnectBridge } from "./bridge.ts";
import { upkeepRoutes } from "./upkeep.ts";

const PRINTER_ID = "x2d";

const nozzle = z.object({ diameter: z.number().min(0.1).max(2), hardened: z.boolean() });
/**
 * Any part of the setup: a nozzle, the plates, the AMS units. What isn't sent
 * is kept as it is, so two people editing different parts never undo each other.
 */
const setupSchema = z.object({
  nozzles: z.object({ main: nozzle, auxiliary: nozzle }).partial().optional(),
  plates: z
    .array(z.string().trim().min(1).max(60))
    .max(20)
    .transform((list) => [...new Set(list)])
    .optional(),
  amsUnits: z.number().int().min(0).max(X2D.maxAmsUnits).optional(),
  /** Days each material stays dry, whole: a material left out goes back to its starting value. */
  dryingDays: z.record(z.string().trim().toUpperCase().min(1).max(20), z.number().int().min(1).max(365)).optional(),
  /** How a model nobody set up is sliced here (decision 0051), whole; null goes back to Spaghetti's own. */
  slicing: slicingDefaults.nullable().optional(),
});

const setSlot = z.object({ spoolId: z.uuid().nullable() });

const BRIDGE_ID = "bridge";
const count = z.number().int().min(0).max(100_000).nullable().optional();
/** What the printer bridge sends. Anything left out stays as it was. */
const bridgeSchema = z.object({
  printerState: z.enum(["idle", "printing", "paused", "finished", "failed", "offline"]).nullable().optional(),
  progress: z
    .object({
      attemptId: z.uuid(),
      percent: z.number().min(0).max(100),
      remainingMinutes: count,
      layer: count,
      totalLayers: count,
    })
    .nullable()
    .optional(),
  unknownTrays: z
    .array(
      z.object({
        slot: z.string().regex(SLOT_PATTERN),
        material: z.string().trim().max(40).nullable(),
        colorHex: z
          .string()
          .regex(/^#[0-9a-f]{6}$/i)
          .transform((value) => value.toLowerCase())
          .nullable(),
        brand: z.string().trim().max(60).nullable(),
      }),
    )
    .max(20)
    .optional(),
  version: z.string().trim().max(40).nullable().optional(),
  platform: z.string().trim().max(40).nullable().optional(),
  problems: z
    .array(z.object({ code: z.enum(BRIDGE_PROBLEM_CODES), message: z.string().trim().min(1).max(400) }))
    .max(5)
    .optional(),
});

async function loadPrinter(db: Db): Promise<PrinterResponse> {
  const [row, slots, bridgeRow, paired] = await Promise.all([
    db.select().from(printer).where(eq(printer.id, PRINTER_ID)).get(),
    // A deleted spool's slot reads as empty (and fills again with undo).
    db
      .select({ slot: amsSlots.slot, spoolId: amsSlots.spoolId })
      .from(amsSlots)
      .innerJoin(spools, eq(spools.id, amsSlots.spoolId))
      .where(isNull(spools.deletedAt)),
    db.select().from(bridge).where(eq(bridge.id, BRIDGE_ID)).get(),
    db
      .select({ usedAt: bridgePairings.usedAt })
      .from(bridgePairings)
      .where(isNotNull(bridgePairings.usedAt))
      .orderBy(desc(bridgePairings.usedAt))
      .limit(1)
      .get(),
  ]);
  return {
    setup: row?.setup ?? DEFAULT_PRINTER,
    slots: Object.fromEntries(slots.map((slot) => [slot.slot, slot.spoolId])),
    bridge: bridgeRow
      ? { ...bridgeRow.status, lastSeenAt: bridgeRow.lastSeenAt.getTime(), pairedAt: paired?.usedAt?.getTime() ?? null }
      : null,
  };
}

/** /api/printer: the X2D as it's set up here, and what is loaded where. Never a live connection. */
export const printerRoutes = new Hono<AppEnv>()
  .route("/upkeep", upkeepRoutes)
  .get("/", async (c) => c.json<PrinterResponse>(await loadPrinter(c.var.db)))

  /** Saves the setup: nozzles fitted, plates owned, AMS units. Whatever is sent replaces that part; the rest stays. */
  .put("/", async (c) => {
    const parsed = setupSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That setup couldn't be read.");
    const now = new Date();
    const current = (await loadPrinter(c.var.db)).setup;
    const setup: PrinterSetup = {
      nozzles: { ...current.nozzles, ...parsed.data.nozzles },
      plates: parsed.data.plates ?? current.plates,
      amsUnits: parsed.data.amsUnits ?? current.amsUnits,
      ...((parsed.data.dryingDays ?? current.dryingDays) && {
        dryingDays: parsed.data.dryingDays ?? current.dryingDays,
      }),
      ...(parsed.data.slicing === null
        ? {}
        : (parsed.data.slicing ?? current.slicing)
          ? { slicing: parsed.data.slicing ?? current.slicing }
          : {}),
    };
    await c.var.db.batch([
      c.var.db
        .insert(printer)
        .values({ id: PRINTER_ID, setup, updatedAt: now })
        .onConflictDoUpdate({ target: printer.id, set: { setup, updatedAt: now } }),
      recordChange(c.var.db, { entity: "printer", id: PRINTER_ID, action: "updated", actor: c.var.actor }),
    ]);
    return c.json<PrinterResponse>(await loadPrinter(c.var.db));
  })

  /**
   * The printer bridge's message: it is alive (always), and optionally the printer's progress and the trays it
   * couldn't match. Only a change in what it says is a change in the feed; a heartbeat just moves "last heard".
   */
  .put("/bridge", async (c) => {
    const parsed = bridgeSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That couldn't be read.");
    const db = c.var.db;
    const body = parsed.data;
    const now = new Date();
    const row = await db.select().from(bridge).where(eq(bridge.id, BRIDGE_ID)).get();
    const before: BridgeStatusData = row?.status ?? { printerState: null, progress: null, unknownTrays: [] };

    let progress = before.progress;
    if (body.progress === null) progress = null;
    else if (body.progress) {
      // Only for a print that is there: an attempt that was deleted meanwhile has nothing to show.
      const attempt = await db
        .select({ id: attempts.id })
        .from(attempts)
        .where(and(eq(attempts.id, body.progress.attemptId), isNull(attempts.deletedAt)))
        .get();
      progress = attempt
        ? {
            attemptId: body.progress.attemptId,
            percent: Math.round(body.progress.percent),
            remainingMinutes: body.progress.remainingMinutes ?? null,
            layer: body.progress.layer ?? null,
            totalLayers: body.progress.totalLayers ?? null,
            at: now.getTime(),
          }
        : null;
    }
    const status: BridgeStatusData = {
      printerState: body.printerState === undefined ? before.printerState : body.printerState,
      progress,
      unknownTrays: body.unknownTrays ?? before.unknownTrays,
      version: body.version === undefined ? before.version : body.version,
      platform: body.platform === undefined ? before.platform : body.platform,
      problems: body.problems ?? before.problems ?? [],
    };
    // Progress is stamped at each message; what counts as a change is the printer's own numbers.
    const same = (a: BridgeStatusData, b: BridgeStatusData) =>
      JSON.stringify({ ...a, progress: a.progress && { ...a.progress, at: 0 } }) ===
      JSON.stringify({ ...b, progress: b.progress && { ...b.progress, at: 0 } });
    const statements = [
      db
        .insert(bridge)
        .values({ id: BRIDGE_ID, lastSeenAt: now, status, agentId: c.var.via })
        .onConflictDoUpdate({
          target: bridge.id,
          set: { lastSeenAt: now, status, ...(c.var.via ? { agentId: c.var.via } : {}) },
        }),
    ] as const;
    if (!row || !same(before, status)) {
      await db.batch([
        ...statements,
        recordChange(db, { entity: "printer", id: BRIDGE_ID, action: "updated", actor: c.var.actor }),
      ]);
    } else await db.batch([...statements]);
    return c.json<PrinterResponse>(await loadPrinter(db));
  })

  /** Disconnects the bridge: its tokens end at once and the Printer page goes back to "No printer bridge". */
  .delete("/bridge", async (c) => {
    await disconnectBridge(c.var.db, c.var.actor);
    return c.json<PrinterResponse>(await loadPrinter(c.var.db));
  })

  /**
   * Loads a spool into a slot ("A1" to "D4", or "Ext"), taking it out of the
   * slot it was in; `spoolId: null` empties the slot.
   */
  .put("/slots/:slot", async (c) => {
    const slot = c.req.param("slot");
    if (!SLOT_PATTERN.test(slot)) return apiError(c, 404, "not_found", "There's no such slot.");
    const parsed = setSlot.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return apiError(c, 400, "invalid", "That couldn't be read.");
    const db = c.var.db;
    const { spoolId } = parsed.data;
    if (!spoolId) {
      await db.batch([
        db.delete(amsSlots).where(eq(amsSlots.slot, slot)),
        // Only if the slot held something.
        recordChange(db, { entity: "slot", id: slot, action: "updated", actor: c.var.actor }),
      ]);
      return c.json<PrinterResponse>(await loadPrinter(db));
    }
    const spool = await db
      .select({ id: spools.id })
      .from(spools)
      .where(and(eq(spools.id, spoolId), isNull(spools.deletedAt)))
      .get();
    if (!spool) return apiError(c, 404, "not_found", "That spool isn't on the shelf any more.");
    const now = new Date();
    await db.batch([
      // Out of wherever it was, and whatever was in this slot comes out.
      db.delete(amsSlots).where(and(eq(amsSlots.spoolId, spoolId), ne(amsSlots.slot, slot))),
      db
        .insert(amsSlots)
        .values({ slot, spoolId, updatedBy: c.var.user.id, updatedAt: now })
        .onConflictDoUpdate({ target: amsSlots.slot, set: { spoolId, updatedBy: c.var.user.id, updatedAt: now } }),
      recordChange(db, { entity: "slot", id: slot, action: "updated", actor: c.var.actor }),
    ]);
    return c.json<PrinterResponse>(await loadPrinter(db));
  });

/** For the OpenAPI document (worker/openapi). */
export { bridgeSchema, setSlot, setupSchema };
