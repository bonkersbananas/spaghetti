/**
 * What the coach is told: the attempt that went wrong, the build's earlier attempts, what worked for the same
 * material elsewhere in the notebook, and how dry the spools are. Text in the notebook's own words
 * (shared/story.ts), plus the attempt's newest pictures (worker/coach/run.ts attaches them); nothing it would need a person's details for.
 */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { type AttemptSettings, outcomeLabel, tagLabel } from "../../shared/attempts.ts";
import { dryingWindow } from "../../shared/drying.ts";
import { recipesFor, settingsMaterial } from "../../shared/recipes.ts";
import { describeResults, describeSettings } from "../../shared/story.ts";
import type { Db } from "../db/index.ts";
import { type Attempt, attemptFiles, attempts, items, photos, recipes, spools } from "../db/schema.ts";
import { toApiAttempts } from "../http.ts";
import { readsByAttempt, toApiPhotoRead } from "../photo-read/run.ts";

const DAY = 24 * 3_600_000;
/** How many pictures the coach looks at. */
export const COACH_MAX_PHOTOS = 3;

export interface CoachPhoto {
  id: string;
  contentType: string;
  width: number;
  height: number;
}

/** The printer camera's end-of-print frame is always 1920x1080: far-off, so the people's own photos come first. */
const isCameraFrame = (photo: { width: number; height: number }) => photo.width === 1920 && photo.height === 1080;

function sentence(attempt: Attempt, change: string[]): string[] {
  const lines = [`Outcome: ${outcomeLabel(attempt.outcome)?.toLowerCase() ?? "not answered yet"}.`];
  if (attempt.failureTags.length) {
    lines.push(`Went wrong: ${attempt.failureTags.map((slug) => tagLabel("failure", slug)).join(", ")}.`);
  }
  if (attempt.successNotes.length) {
    lines.push(`Went well: ${attempt.successNotes.map((slug) => tagLabel("success", slug)).join(", ")}.`);
  }
  if (attempt.note.trim()) lines.push(`Their note: ${attempt.note.trim().slice(0, 300)}`);
  if (change.length) lines.push(`Changed from the attempt before: ${change.join("; ")}.`);
  const settings = describeSettings(attempt.settings);
  if (settings.length) lines.push(`Settings: ${settings.join(", ")}.`);
  const results = describeResults(attempt.settings);
  if (results.length) lines.push(`Result: ${results.join(", ")}.`);
  return lines;
}

/** The text Claude reads, or null when the attempt is gone. */
export async function coachNotebook(
  db: Db,
  attemptId: string,
  now: number,
): Promise<{ text: string; attempt: Attempt; photos: CoachPhoto[]; basis: string } | null> {
  const found = await db
    .select({ attempt: attempts, title: items.title, note: items.note })
    .from(attempts)
    .innerJoin(items, eq(items.id, attempts.itemId))
    .where(and(eq(attempts.id, attemptId), isNull(attempts.deletedAt), isNull(items.deletedAt)))
    .get();
  if (!found) return null;
  const { attempt } = found;
  const siblings = await db
    .select()
    .from(attempts)
    .where(and(eq(attempts.itemId, attempt.itemId), isNull(attempts.deletedAt)));
  const ordered = toApiAttempts(siblings);
  const index = ordered.findIndex((row) => row.id === attempt.id);
  const rowById = new Map(siblings.map((row) => [row.id, row]));
  const lines: string[] = [`The build: ${found.title?.trim() || "untitled"}.`];
  if (found.note.trim()) lines.push(`About it: ${found.note.trim().slice(0, 400)}`);

  lines.push("", `## The attempt that went wrong (attempt ${index + 1})`);
  lines.push(...sentence(attempt, ordered[index]?.changes.map((change) => change.text) ?? []));
  const read = toApiPhotoRead((await readsByAttempt(db, [attempt.id])).get(attempt.id) ?? []);
  if (read?.status === "read" && read.reason) lines.push(`What a look at its photo showed: ${read.reason}`);
  if (attempt.suggestedFailureTag) lines.push(`The printer reported: ${attempt.suggestedFailureTag}.`);
  // The attempt's pictures, newest first, the people's own close-ups ahead of the printer's far-off camera frame.
  const pictures = (
    await db
      .select({
        id: photos.id,
        contentType: photos.contentType,
        width: photos.width,
        height: photos.height,
      })
      .from(photos)
      .where(and(eq(photos.attemptId, attempt.id), isNull(photos.deletedAt)))
      .orderBy(desc(photos.createdAt), desc(photos.id))
  ).sort((a, b) => Number(isCameraFrame(a)) - Number(isCameraFrame(b)));
  const shown = pictures.slice(0, COACH_MAX_PHOTOS);
  if (shown.length) {
    lines.push(
      `Pictures of this print are attached (${shown.length}): ${
        shown.every(isCameraFrame)
          ? "only the printer camera's wide frame, taken from far away"
          : `their own close-ups first${shown.some(isCameraFrame) ? ", then the printer camera's wide frame" : ""}`
      }.`,
    );
  }
  const file = await db
    .select({ name: attemptFiles.name, plate: attemptFiles.plate, plateCount: attemptFiles.plateCount })
    .from(attemptFiles)
    .where(and(eq(attemptFiles.attemptId, attempt.id), isNull(attemptFiles.deletedAt)))
    .get();
  if (file) lines.push(`Sliced file: ${file.name} (plate ${file.plate} of ${file.plateCount}).`);

  // The spools it printed on: how long since they were dried.
  const spoolIds = (attempt.settings.filaments ?? []).flatMap((filament) =>
    filament.spoolId ? [filament.spoolId] : [],
  );
  if (spoolIds.length) {
    const rows = await db
      .select()
      .from(spools)
      .where(and(inArray(spools.id, spoolIds), isNull(spools.deletedAt)));
    for (const spool of rows) {
      const name = [spool.brand, spool.material, spool.colorName].filter(Boolean).join(" ");
      const window = dryingWindow(spool.material);
      const since = spool.driedAt
        ? `last dried ${Math.max(0, Math.round((now - spool.driedAt.getTime()) / (7 * DAY)))} weeks ago`
        : `never recorded as dried (in the pantry for ${Math.max(0, Math.round((now - spool.createdAt.getTime()) / (7 * DAY)))} weeks)`;
      lines.push(`Spool ${name}: ${since}${window ? `; ${spool.material} stays dry about ${window} days` : ""}.`);
    }
  } else if (attempt.settings.filamentDried !== undefined) {
    lines.push(attempt.settings.filamentDried ? "The filament was dried." : "The filament wasn't dried.");
  }

  const earlier = ordered.slice(0, index);
  if (earlier.length) {
    lines.push("", "## The build's earlier attempts");
    earlier.forEach((row, i) => {
      const source = rowById.get(row.id);
      if (!source) return;
      lines.push(
        `Attempt ${i + 1}: ${sentence(
          source,
          row.changes.map((change) => change.text),
        ).join(" ")}`,
      );
    });
  }

  // What worked for the same material elsewhere in the notebook, and the recipes for it.
  const material = settingsMaterial(attempt.settings);
  if (material) {
    const worked = (
      await db
        .select({ attempt: attempts, title: items.title })
        .from(attempts)
        .innerJoin(items, eq(items.id, attempts.itemId))
        .where(and(eq(attempts.outcome, "success"), isNull(attempts.deletedAt), isNull(items.deletedAt)))
        .orderBy(desc(attempts.printedAt))
        .limit(80)
    )
      .filter((row) => settingsMaterial(row.attempt.settings) === material)
      .sort((a, b) => Number(b.attempt.itemId === attempt.itemId) - Number(a.attempt.itemId === attempt.itemId))
      .slice(0, 3);
    if (worked.length) {
      lines.push("", `## What worked with ${material} in the notebook`);
      for (const row of worked) {
        const settings: AttemptSettings = row.attempt.settings;
        lines.push(
          `- ${row.title?.trim() || "A build"}${row.attempt.itemId === attempt.itemId ? " (this build)" : ""}: ${describeSettings(settings).join(", ") || "no settings recorded"}.`,
        );
      }
    }
    const recipeRows = recipesFor(
      (await db.select().from(recipes).where(isNull(recipes.deletedAt))).map((r) => ({
        ...r,
        createdAt: r.createdAt.getTime(),
      })),
      { material },
    ).slice(0, 3);
    if (recipeRows.length) {
      lines.push("", `## Recipes for ${material}`);
      for (const recipe of recipeRows) {
        lines.push(
          `- ${recipe.name}: ${describeSettings(recipe.settings).join(", ")}.${recipe.note ? ` ${recipe.note.slice(0, 200)}` : ""}`,
        );
      }
    }
  }
  // What this was told that people can add to afterwards: if it differs later, the answer grew.
  const basis = JSON.stringify([
    attempt.note.trim(),
    attempt.outcome,
    attempt.failureTags,
    attempt.successNotes,
    shown.map((photo) => photo.id),
  ]);
  return { text: lines.join("\n"), attempt, photos: shown, basis };
}
