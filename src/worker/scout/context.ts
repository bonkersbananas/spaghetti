import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { OUTCOME_LABELS, tagLabel } from "../../shared/attempts.ts";
import { settingsMaterial } from "../../shared/recipes.ts";
import { scoutKeysIn } from "../../shared/scout.ts";
import { REMAINING_LABELS } from "../../shared/spools.ts";
import type { Db } from "../db/index.ts";
import { attempts, items, scoutPicks, spools, users, wishlistEntries } from "../db/schema.ts";

const clip = (text: string, length: number) => {
  const line = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return line.length > length ? `${line.slice(0, length - 1)}…` : line;
};

export interface ScoutNotebook {
  /** What Claude reads: wishes, ideas, builds and how they went, the filament in the Pantry. */
  text: string;
  /** Whether the notebook holds anything to go on at all: an empty one gets no suggestions, a guess is worse than nothing. */
  hasSignal: boolean;
  /** Every model the scout may not suggest: already suggested (kept or dismissed or still waiting), or already an idea. */
  seen: Set<string>;
}

/**
 * What the scout is told about the two of you, in the notebook's own words. A wishlist kept private is never read
 * (the suggestions are shown to both), and no photo is sent. Titles and notes are information, never instructions.
 */
export async function scoutNotebook(db: Db): Promise<ScoutNotebook> {
  const people = await db.select({ id: users.id, name: users.name, isPrivate: users.wishlistPrivate }).from(users);
  const names = new Map(people.map((person) => [person.id, person.name]));
  const who = (id: string) => names.get(id) ?? "Someone";
  const lines: string[] = [];
  let signal = 0;

  // Wishlists: each person's top ideas, best first.
  for (const person of people.filter((p) => !p.isPrivate)) {
    const wishes = await db
      .select({ title: items.title, note: items.note })
      .from(wishlistEntries)
      .innerJoin(items, eq(items.id, wishlistEntries.itemId))
      .where(and(eq(wishlistEntries.userId, person.id), eq(items.stage, "idea"), isNull(items.deletedAt)))
      .orderBy(wishlistEntries.position)
      .limit(8);
    if (!wishes.length) continue;
    signal += wishes.length;
    lines.push("", `## ${person.name}'s wishlist, best first`);
    for (const wish of wishes) lines.push(`- ${wish.title?.trim() || clip(wish.note, 80) || "untitled"}`);
  }

  // Ideas, newest first (the ones with a link are also what must not be suggested twice).
  const ideas = await db
    .select({ title: items.title, note: items.note, forWhom: items.forWhom, by: items.createdBy })
    .from(items)
    .where(and(eq(items.stage, "idea"), isNull(items.deletedAt)))
    .orderBy(desc(items.createdAt))
    .limit(30);
  const withLinks = await db
    .select({ note: items.note })
    .from(items)
    .where(and(isNull(items.deletedAt), ne(items.note, "")));
  if (ideas.length) {
    signal += ideas.length;
    lines.push("", "## Ideas they saved lately");
    for (const idea of ideas.slice(0, 20)) {
      const text = idea.title?.trim() || clip(idea.note, 80);
      if (!text) continue;
      const detail = [clip(idea.note, 100), idea.forWhom ? `for ${idea.forWhom}` : "", `saved by ${who(idea.by)}`]
        .filter((part) => part && part !== text)
        .join("; ");
      lines.push(`- ${text}${detail ? ` (${detail})` : ""}`);
    }
  }

  // What they built and how it went.
  const builds = await db
    .select({ id: items.id, title: items.title, stage: items.stage })
    .from(items)
    .where(and(inArray(items.stage, ["building", "done", "shelved"]), isNull(items.deletedAt)))
    .orderBy(desc(items.updatedAt))
    .limit(15);
  if (builds.length) {
    const tries = await db
      .select()
      .from(attempts)
      .where(
        and(
          isNull(attempts.deletedAt),
          inArray(
            attempts.itemId,
            builds.map((build) => build.id),
          ),
        ),
      )
      .orderBy(attempts.printedAt);
    signal += builds.length;
    lines.push("", "## What they printed and how it went");
    for (const build of builds) {
      const own = tries.filter((attempt) => attempt.itemId === build.id);
      const material = [...new Set(own.map((attempt) => settingsMaterial(attempt.settings)).filter(Boolean))].join("/");
      const outcomes = [...new Set(own.map((a) => (a.outcome ? OUTCOME_LABELS[a.outcome] : null)).filter(Boolean))];
      const wrong = [...new Set(own.flatMap((attempt) => attempt.failureTags))]
        .map((slug) => tagLabel("failure", slug))
        .slice(0, 4);
      lines.push(
        `- ${build.title?.trim() || "untitled"} (${build.stage}${material ? `, ${material}` : ""}${
          outcomes.length ? `; ${outcomes.join(", ")}` : ""
        }${wrong.length ? `; went wrong: ${wrong.join(", ")}` : ""})`,
      );
    }
  }

  // The filament they have.
  const rolls = await db
    .select({ material: spools.material, brand: spools.brand, color: spools.colorName, remaining: spools.remaining })
    .from(spools)
    .where(ne(spools.remaining, "empty"));
  if (rolls.length) {
    lines.push("", "## Filament in the Pantry");
    for (const roll of rolls.slice(0, 20)) {
      lines.push(
        `- ${[roll.material, roll.brand, roll.color].filter(Boolean).join(" ")} (${REMAINING_LABELS[roll.remaining]})`,
      );
    }
  }

  // Never suggest the same model twice: everything the scout ever showed, and every link already in an idea.
  const shown = await db
    .select({ key: scoutPicks.key, title: scoutPicks.title, status: scoutPicks.status })
    .from(scoutPicks);
  const seen = new Set<string>([
    ...shown.map((pick) => pick.key),
    ...withLinks.flatMap((item) => scoutKeysIn(item.note)),
  ]);
  if (shown.length) {
    lines.push("", "## Already suggested before (do not suggest these or near-duplicates)");
    for (const pick of shown.slice(-40))
      lines.push(`- ${pick.title}${pick.status === "dismissed" ? " (not for them)" : ""}`);
  }
  return { text: lines.join("\n").trim(), hasSignal: signal > 0, seen };
}
