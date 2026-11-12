import type { APIRequestContext } from "@playwright/test";
import { executeSql } from "../lib/wrangler.ts";
import { SEED_BUILD_IDS } from "./builds.ts";
import { SEED_IDS } from "./ideas.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

interface SeedComment {
  /** Sorts into a stable id. */
  n: number;
  by: "alex" | "sam";
  itemId: string;
  ago: number;
  body: string;
}

export const commentId = (n: number) => `5eed0000-0000-4000-8000-0000000c${String(n).padStart(4, "0")}`;

/** Two short threads, one on an idea (its last comment from Sam is unread for Alex) and one on a build (all read). */
export const SEED_COMMENTS: SeedComment[] = [
  {
    n: 1,
    by: "sam",
    itemId: SEED_IDS.deskTidy,
    ago: 2 * DAY + 3 * HOUR,
    body: "These would fit the desk drawer perfectly: https://makerworld.com/en/models/drawer-bins",
  },
  { n: 2, by: "alex", itemId: SEED_IDS.deskTidy, ago: 2 * DAY + 2 * HOUR, body: "Nice find. Is it the 42 mm grid?" },
  {
    n: 3,
    by: "alex",
    itemId: SEED_IDS.deskTidy,
    ago: 2 * DAY + 2 * HOUR - 2 * MIN,
    body: "I could start them tonight.",
  },
  {
    n: 4,
    by: "sam",
    itemId: SEED_IDS.deskTidy,
    ago: 40 * MIN,
    body: "Yes, 42 mm. Blue PETG if there's still some left?",
  },

  {
    n: 5,
    by: "sam",
    itemId: SEED_BUILD_IDS.tugboat,
    ago: 3 * DAY,
    body: "Could you print the hull a bit chunkier? Mila will carry it with both hands.",
  },
  {
    n: 6,
    by: "alex",
    itemId: SEED_BUILD_IDS.tugboat,
    ago: 3 * DAY - 20 * MIN,
    body: "Started it tonight, the first layer looked great.",
  },
  { n: 7, by: "alex", itemId: SEED_BUILD_IDS.tugboat, ago: 3 * DAY - 22 * MIN, body: "Two halves, as we said." },
  { n: 8, by: "sam", itemId: SEED_BUILD_IDS.tugboat, ago: 2 * DAY + 20 * HOUR, body: "It floats upright! 🎉" },
];

/** Reactions from both people: on the desk tidy-up idea and the tugboat build, and on a few of their comments. */
const SEED_REACTIONS: Array<{ by: "alex" | "sam"; path: string; kind: string }> = [
  { by: "sam", path: `/api/items/${SEED_IDS.deskTidy}`, kind: "🤩" },
  { by: "alex", path: `/api/items/${SEED_IDS.deskTidy}`, kind: "🤩" },
  { by: "sam", path: `/api/items/${SEED_IDS.deskTidy}`, kind: "🤌" },
  { by: "sam", path: `/api/items/${SEED_BUILD_IDS.tugboat}`, kind: "❤️" },
  { by: "alex", path: `/api/items/${SEED_BUILD_IDS.tugboat}`, kind: "❤️" },
  { by: "alex", path: `/api/comments/${commentId(1)}`, kind: "❤️" },
  { by: "sam", path: `/api/comments/${commentId(3)}`, kind: "🔥" },
  { by: "alex", path: `/api/comments/${commentId(8)}`, kind: "👏" },
  { by: "sam", path: `/api/comments/${commentId(8)}`, kind: "👏" },
  { by: "alex", path: `/api/comments/${commentId(8)}`, kind: "🫠" },
  { by: "sam", path: `/api/comments/${commentId(8)}`, kind: "🎉" },
];

/**
 * Writes the threads through the API, then backdates them (the server stamps "now") and sets Alex's read
 * state: she has read everything but Sam's last comment on the desk tidy-up idea.
 */
export async function seedComments(
  people: { alex: APIRequestContext; sam: APIRequestContext },
  origin: string,
  stateDir: string,
  now: number,
) {
  for (const comment of [...SEED_COMMENTS].sort((a, b) => b.ago - a.ago)) {
    const response = await people[comment.by].post(`/api/items/${comment.itemId}/comments`, {
      headers: { Origin: origin },
      data: { id: commentId(comment.n), body: comment.body },
    });
    if (!response.ok()) throw new Error(`Seeding comment ${comment.n} failed: ${response.status()}`);
  }
  for (const reaction of SEED_REACTIONS) {
    const response = await people[reaction.by].put(`${reaction.path}/reactions/${encodeURIComponent(reaction.kind)}`, {
      headers: { Origin: origin },
    });
    // screenshots:compare seeds an older base with this seed: one without reactions answers 404, and goes without.
    if (response.status() === 404) break;
    if (!response.ok()) throw new Error(`Seeding a reaction failed: ${response.status()}`);
  }
  const unread = SEED_COMMENTS.find((comment) => comment.n === 4);
  executeSql(
    [
      ...SEED_COMMENTS.map(
        (comment) => `UPDATE comments SET created_at = ${now - comment.ago} WHERE id = '${commentId(comment.n)}';`,
      ),
      "DELETE FROM comment_reads;",
      `INSERT INTO comment_reads (user_id, item_id, read_at) SELECT id, '${SEED_IDS.deskTidy}', ${now - (unread?.ago ?? 0) - 5 * MIN} FROM users WHERE username = 'alex';`,
      `INSERT INTO comment_reads (user_id, item_id, read_at) SELECT id, '${SEED_BUILD_IDS.tugboat}', ${now} FROM users WHERE username = 'alex';`,
      `INSERT INTO comment_reads (user_id, item_id, read_at) SELECT id, '${SEED_BUILD_IDS.tugboat}', ${now} FROM users WHERE username = 'sam';`,
    ].join("\n"),
    { persistTo: stateDir },
  );
}
