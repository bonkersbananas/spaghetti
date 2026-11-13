import { z } from "zod";
import { AGENT_SCOPES } from "../../shared/agents.ts";
import { authorizeParams } from "../oauth/authorize.ts";
import { changePasswordBody } from "../routes/account.ts";
import { createAgent, createToken } from "../routes/agents.ts";
import { createAttempt, finishAttempt, updateAttempt } from "../routes/attempts.ts";
import { captureFields } from "../routes/capture.ts";
import { changesQuery } from "../routes/changes.ts";
import { createComment, updateComment } from "../routes/comments.ts";
import { draftBody } from "../routes/drafts.ts";
import { fileChange, fileFields, slicedFields } from "../routes/files.ts";
import { insightsQuery } from "../routes/insights.ts";
import {
  createItem,
  itemPhotoFields,
  listQuery,
  moveInto,
  putParts,
  reorder,
  unmoveInto,
  unscrap,
  updateItem,
  upNextOrder,
} from "../routes/items.ts";
import { journalQuery, summaryQuery } from "../routes/journal.ts";
import { decision } from "../routes/oauth.ts";
import { bridgeSchema, setSlot, setupSchema } from "../routes/printer.ts";
import { pushChange, pushTarget, subscribe } from "../routes/push.ts";
import { createRecipe, recipeQuery, updateRecipe } from "../routes/recipes.ts";
import { scoutKeepBody } from "../routes/scout.ts";
import { searchQuery, whatWorkedQuery } from "../routes/search.ts";
import { credentials, signOutBody } from "../routes/session.ts";
import { createShoppingItem, shoppingOrder, updateShoppingItem } from "../routes/shopping-items.ts";
import { createSpool, readLabelBody, spoolPhotoFields, updateSpool, weighBody, weightBody } from "../routes/spools.ts";
import { createTag } from "../routes/tags.ts";
import { createTwist, updateTwist } from "../routes/twists.ts";
import { createTask, logBody, updateTask, upkeepPhotoFields } from "../routes/upkeep.ts";
import { createWebhook } from "../routes/webhooks.ts";
import { addToWishlist, updateWishlist, wishlistOrder } from "../routes/wishlists.ts";
import {
  Agent,
  Attempt,
  AttemptFile,
  ChangesResponse as Changes,
  Delivery,
  Item,
  list,
  loose,
  NewToken,
  one,
  Person,
  Photo,
  Reaction,
  Spool,
  Webhook,
  Wishlist,
} from "./schemas.ts";

/**
 * Every route of the API, described once (the OpenAPI document is made from this table, and
 * test/worker/openapi.test.ts fails for any route that isn't in it, or any row that has no route).
 * Each row: the route as Hono lists it, a one-line summary in the docs' voice, and what is particular
 * to it. Request bodies and queries are the zod schemas the route validates with; the scopes come from
 * auth/scopes.ts, never from here.
 */

export interface Operation {
  summary: string;
  /** The query string, a zod object. */
  query?: z.ZodType;
  /** A JSON body. */
  body?: z.ZodType;
  /** A multipart body: the fields, and the files (name → what it is). */
  multipart?: { fields: z.ZodType; files: Record<string, string>; required?: string[] };
  /** The JSON answer, or what else it is. */
  response?: z.ZodType | "binary" | "markdown" | "empty";
  /** The success status: 200 unless said. */
  status?: 200 | 201 | 204;
  /** Other refusals this route gives, by status: the code and when. */
  errors?: Record<number, string>;
  /** No credentials needed. */
  public?: true;
  /** What a longer explanation would add (a sentence or two). */
  description?: string;
}

const photoFiles = { large: "The photo at display size (WebP or JPEG).", thumb: "The same photo as a thumbnail." };
const notFound = (what: string) => `not_found: no such ${what}.`;
const any = (description: string, shape?: Record<string, z.ZodType>) => loose(description, shape);
const ceremony = (description: string) => z.object({ ceremonyId: z.string(), options: any(description) });
const ceremonyAnswer = z.object({
  ceremonyId: z.string(),
  response: any("The browser's answer (@simplewebauthn JSON)."),
});
const joinDetails = z.object({
  token: z.string(),
  name: z.string(),
  username: z.string(),
  color: z.string(),
});

const reactionEmoji =
  "kind is the emoji itself, URL-encoded (one emoji from the Unicode RGI set, such as %F0%9F%94%A5 for fire)";
const emojiUse = z.object({
  popular: z.array(z.string()).describe("The emoji the two of you give most, most used first."),
  recent: z.array(z.string()).describe("The ones you gave last, newest first."),
});
const reactionsAnswer = z.object({ reactions: z.array(Reaction) });

export const operations: Record<string, Operation> = {
  "GET /health": { summary: "Says the Worker is up.", response: z.object({ ok: z.literal(true) }), public: true },

  // Session and account: people only.
  "GET /session": { summary: "Who is signed in.", response: z.object({ user: Person }) },
  "POST /session": {
    summary: "Signs in with a username and password; sets the session cookie.",
    body: credentials,
    response: z.object({ user: Person }),
    errors: { 401: "wrong_credentials: that name and password don't match." },
    public: true,
  },
  "DELETE /session": {
    summary: "Signs out this device (and forgets its push subscription, if told which).",
    body: signOutBody,
    response: "empty",
    status: 204,
  },
  "PUT /account/password": {
    summary: "Changes your password and signs out your other devices.",
    body: changePasswordBody,
    response: z.object({ signedOut: z.number().int() }),
    errors: {
      400: "too_short or same_password: ten characters at least, and a new one.",
      403: "wrong_password: the current password is wrong.",
      429: "rate_limited: five wrong passwords in a quarter of an hour.",
    },
  },

  // Passkeys, sign-in links, invites and devices (docs/api.md): the ones under /account are people only.
  "POST /session/passkey/options": {
    summary: "Starts a passkey sign-in: the challenge for the browser's sheet.",
    response: ceremony("WebAuthn request options (@simplewebauthn JSON)."),
    errors: { 429: "rate_limited: too many tries." },
    public: true,
  },
  "POST /session/passkey": {
    summary: "Signs in with a passkey the browser signed; sets the session cookie.",
    body: ceremonyAnswer,
    response: z.object({ user: Person }),
    errors: { 401: "wrong_credentials: wrong, replayed, expired or from another origin.", 429: "rate_limited." },
    public: true,
  },
  "POST /session/link": {
    summary: "Signs in with a single-use link's token or its short code, made on a signed-in device.",
    body: z.object({ token: z.string().optional(), code: z.string().optional() }),
    response: z.object({ user: Person }),
    errors: { 410: "link_gone: used or expired.", 429: "rate_limited." },
    public: true,
  },
  "POST /join/peek": {
    summary: "Who an invite is from, if it can still be used.",
    body: z.object({ token: z.string() }),
    response: z.object({ invitedBy: z.string(), expiresAt: z.number().int() }),
    errors: { 410: "invite_gone: used, withdrawn or expired." },
    public: true,
  },
  "POST /join/options": {
    summary: "Starts a passkey for the person an invite adds.",
    body: joinDetails,
    response: ceremony("WebAuthn creation options (@simplewebauthn JSON)."),
    errors: { 409: "username_taken.", 410: "invite_gone." },
    public: true,
  },
  "POST /join": {
    summary: "Uses an invite: adds that one person with a password or passkey, and signs them in.",
    body: joinDetails.extend({ password: z.string().optional(), passkey: ceremonyAnswer.optional() }),
    response: z.object({ user: Person }),
    status: 201,
    errors: { 400: "too_short, not_verified or expired.", 409: "username_taken.", 410: "invite_gone." },
    public: true,
  },
  "GET /account/passkeys": {
    summary: "Your passkeys, and whether you also have a password.",
    response: any("Passkeys.", { passkeys: z.array(z.looseObject({})), hasPassword: z.boolean() }),
  },
  "POST /account/passkeys/options": {
    summary: "Starts adding a passkey for this device.",
    response: ceremony("WebAuthn creation options (@simplewebauthn JSON)."),
    errors: { 409: "too_many: twelve is the most." },
  },
  "POST /account/passkeys": {
    summary: "Finishes adding a passkey.",
    body: ceremonyAnswer,
    response: any("The new passkey."),
    status: 201,
    errors: { 400: "not_verified or expired.", 409: "exists or too_many." },
  },
  "PATCH /account/passkeys/:id": {
    summary: "Renames one of your passkeys.",
    body: z.object({ name: z.string() }),
    response: any("The passkey."),
    errors: { 404: notFound("passkey") },
  },
  "DELETE /account/passkeys/:id": {
    summary: "Removes one of your passkeys.",
    response: "empty",
    status: 204,
    errors: { 409: "last_way_in: it is the only way you can sign in." },
  },
  "POST /account/sign-in-links": {
    summary: "Makes a single-use link and code to sign in on another device, good for ten minutes.",
    response: any("The link (its secret is after the #), the code and when it expires."),
    status: 201,
    errors: { 429: "rate_limited." },
  },
  "GET /account/sign-in-links/:id": {
    summary: "Whether, and on which device, a link was used.",
    response: any("The link's state."),
    errors: { 404: notFound("link") },
  },
  "DELETE /account/sign-in-links/:id": { summary: "Withdraws an unused link.", response: "empty", status: 204 },
  "GET /account/invites": {
    summary: "The invites still waiting.",
    response: any("Invites.", { invites: z.array(z.looseObject({})) }),
  },
  "POST /account/invites": {
    summary: "Makes a single-use invite link, good for a week.",
    response: any("The invite and its link (shown once)."),
    status: 201,
    errors: { 409: "too_many: withdraw one first." },
  },
  "DELETE /account/invites/:id": { summary: "Withdraws an invite.", response: "empty", status: 204 },
  "GET /account/devices": {
    summary: "The devices you are signed in on.",
    response: any("Devices.", { devices: z.array(z.looseObject({})) }),
  },
  "POST /account/devices/sign-out-others": {
    summary: "Signs you out everywhere but here.",
    response: z.object({ signedOut: z.number().int() }),
  },
  "DELETE /account/devices/:id": {
    summary: "Signs one device out.",
    response: "empty",
    status: 204,
    errors: { 400: "current: that is this device." },
  },

  // Push.
  "GET /push": {
    summary: "Whether web push is set up on this server, and this person's devices.",
    response: any("Push settings.", {
      publicKey: z.string().nullable(),
      canSend: z.boolean(),
      subscriptions: z.array(z.looseObject({})),
    }),
  },
  "PUT /push/subscription": {
    summary: "Saves this device for web push.",
    body: subscribe,
    response: "empty",
    status: 204,
  },
  "PATCH /push/subscription": {
    summary: "Changes what this device is told about.",
    body: pushChange,
    response: "empty",
    status: 204,
  },
  "DELETE /push/subscription": { summary: "Forgets this device.", body: pushTarget, response: "empty", status: 204 },
  "POST /push/test": { summary: "Sends a test push to this device.", body: pushTarget, response: "empty", status: 204 },

  // People and agents.
  "GET /people": { summary: "The two people.", response: list("people", Person) },
  "GET /people/:id/photo": {
    summary: "A person's profile picture.",
    response: "binary",
    errors: { 404: notFound("picture") },
  },
  "PUT /people/me/photo": {
    summary: "Sets your own profile picture.",
    multipart: {
      fields: z.object({}),
      files: { photo: "A square WebP or JPEG, at most 512 KB." },
      required: ["photo"],
    },
    response: z.object({ user: Person }),
    errors: { 413: "too_large: over 512 KB.", 415: "unsupported: not WebP or JPEG." },
  },
  "DELETE /people/me/photo": { summary: "Goes back to initials.", response: z.object({ user: Person }) },
  "GET /agents": { summary: "Every agent, with tokens listed only for their owner.", response: list("agents", Agent) },
  "POST /agents": {
    summary: "Makes an agent with its first token, which is shown once.",
    body: createAgent,
    response: NewToken,
    status: 201,
    errors: { 409: "conflict: that agent already exists." },
  },
  "POST /agents/:id/tokens": {
    summary: "Makes another token for one of your agents, shown once.",
    body: createToken,
    response: NewToken,
    status: 201,
    errors: { 404: notFound("agent") },
  },
  "DELETE /agents/:id/tokens/:tokenId": {
    summary: "Revokes a token; it stops working on its next request.",
    response: "empty",
    status: 204,
    errors: { 404: notFound("agent") },
  },

  // Connecting Claude's apps (OAuth, docs/mcp.md): the consent screen's two calls. The protocol's own endpoints
  // (/.well-known/…, /oauth/register, /oauth/token, /oauth/revoke) live outside /api.
  "GET /oauth/request": {
    summary: "What an app asks for before it is let in: its name, where it returns to and the scopes. People only.",
    query: authorizeParams.omit({ response_type: true }).extend({ response_type: z.literal("code") }),
    response: z.object({ app: z.string(), returnsTo: z.string(), scopes: z.array(z.enum(AGENT_SCOPES)) }),
    errors: { 400: "invalid_request, invalid_client or invalid_target: the request can't be asked about." },
  },
  "POST /oauth/decision": {
    summary: "Approves or declines an app's request; answers with where to send the person back. People only.",
    body: decision,
    response: z.object({ redirectTo: z.string() }),
    errors: { 400: "invalid_request, invalid_client or invalid_target." },
  },
  "DELETE /agents/:id/connection": {
    summary: "Disconnects an app connected by OAuth: its access and refresh tokens all end at once.",
    response: "empty",
    status: 204,
    errors: { 404: notFound("agent") },
  },

  // Webhooks.
  "GET /webhooks": { summary: "Your webhooks, without their secrets.", response: list("webhooks", Webhook) },
  "POST /webhooks": {
    summary: "Adds a webhook; its signing secret is shown once.",
    body: createWebhook,
    response: z.object({
      webhook: Webhook,
      secret: z.string().describe("Shown once; stored so it can sign, never readable again."),
    }),
    status: 201,
    errors: {
      409: "too_many or conflict: ten at most, and each id once.",
      422: "unsafe_url: not a public https address.",
      503: "webhooks_unavailable: the server has no key to keep secrets under.",
    },
    description: "See docs/api.md, Webhooks, for the payload and how to check its signature.",
  },
  "DELETE /webhooks/:id": {
    summary: "Removes a webhook (it can be restored).",
    response: "empty",
    status: 204,
    errors: { 404: notFound("webhook") },
  },
  "POST /webhooks/:id/restore": {
    summary: "Brings back a removed webhook.",
    response: one("webhook", Webhook),
    errors: { 404: notFound("webhook") },
  },
  "GET /webhooks/:id/deliveries": {
    summary: "The latest deliveries of a webhook, newest first.",
    response: list("deliveries", Delivery),
    errors: { 404: notFound("webhook") },
  },
  "POST /webhooks/:id/test": {
    summary: "Sends a made-up change to the webhook now and says how it went.",
    response: one("delivery", Delivery),
    status: 201,
    errors: { 404: notFound("webhook") },
  },
  "POST /webhooks/:id/deliveries/:deliveryId/retry": {
    summary: "Sends a delivery again now, with a fresh day of retries.",
    response: one("delivery", Delivery),
    errors: { 404: notFound("delivery") },
  },

  // The change feed and sharing in.
  "GET /changes": {
    summary: "What changed since a cursor; without one, only the feed's current end.",
    query: changesQuery,
    response: Changes,
  },
  "POST /capture": {
    summary: "Captures an idea from a link, some text or photos in one call (iOS Shortcuts, the bookmarklet).",
    body: captureFields,
    response: z.object({ id: z.string(), url: z.string(), photos: z.number().int(), message: z.string() }),
    status: 201,
    description:
      "Also takes form data and raw bodies; it answers non-JSON callers with a plain sentence. See docs/share.md.",
  },
  "GET /deleted": {
    summary: "Ideas, builds and attempts deleted in the last 30 days, which can still be restored.",
    response: any("The things that can be restored.", {
      items: z.array(z.looseObject({})),
      attempts: z.array(z.looseObject({})),
    }),
  },
  "GET /features": {
    summary: "What this server can do beyond the basics (Claude drafts and photo reads, webhooks).",
    response: z.object({
      drafts: z.boolean(),
      photoReads: z.boolean(),
      labelReads: z.boolean(),
      priceSuggestions: z.boolean(),
      coach: z.boolean(),
      webhooks: z.boolean(),
    }),
  },

  // Items.
  "POST /items/:id/draft": {
    summary: "Asks Claude to draft an idea from its model page, in the background.",
    body: draftBody,
    response: z.object({ draft: z.looseObject({}).nullable() }),
    errors: {
      400: "invalid: no MakerWorld, Printables or Thingiverse link to read.",
      404: "not_found: no such idea, or drafting isn't set up.",
    },
  },
  "POST /items/:id/draft/pictures": {
    summary: "Gets the pictures of a drafted idea that has none (tries the model page's pictures again).",
    response: z.object({ draft: z.looseObject({}).nullable(), stored: z.number().int() }),
    errors: { 404: "not_found: no draft, the idea has pictures already, or drafting isn't set up." },
  },
  "DELETE /items/:id/draft": {
    summary: "Drops Claude's draft of an idea.",
    response: z.object({ draft: z.null() }),
    errors: { 404: notFound("idea") },
  },
  "GET /items": {
    summary: "Ideas and builds, newest first; `stage` narrows it.",
    query: listQuery,
    response: list("items", Item),
  },
  "POST /items": {
    summary: "Adds an idea, or a build from scratch; the client picks the id, so a retry is safe.",
    body: createItem,
    response: one("item", Item),
    status: 201,
  },
  "PUT /items/up-next/order": {
    summary: "Sets the order of the Up next queue.",
    body: upNextOrder,
    response: list("items", Item),
  },
  "GET /items/:id": {
    summary: "One idea or build with its photos, attempts and parts.",
    response: one("item", Item),
    errors: { 404: notFound("item") },
  },
  "PATCH /items/:id": {
    summary: "Changes an item's title, note, stage, cover photo, Up next place or recipient.",
    body: updateItem,
    response: one("item", Item),
    errors: { 404: notFound("item"), 403: "missing_scope: a stage move or cover photo needs attempts." },
  },
  "PUT /items/:id/parts": {
    summary: "Adds or changes a build's parts; the ones not listed are left alone.",
    body: putParts,
    response: one("item", Item),
    errors: { 404: notFound("item") },
  },
  "DELETE /items/:id/parts/:partId": { summary: "Removes a part.", response: "empty", status: 204 },
  "DELETE /items/:id": {
    summary: "Deletes an idea or build (it can be restored for 30 days).",
    response: "empty",
    status: 204,
  },
  "POST /items/:id/scrap": {
    summary: "Scraps a build back to an idea, keeping its history.",
    response: one("item", Item),
    errors: { 404: notFound("build") },
  },
  "POST /items/:id/unscrap": {
    summary: "Undoes a scrap: the build as it was.",
    body: unscrap,
    response: one("item", Item),
  },
  "POST /items/:id/move": {
    summary: "Moves an idea's photos and note into a build or one of its attempts; the idea goes away. People only.",
    body: moveInto,
    response: one("item", Item),
    errors: {
      404: notFound("idea or build"),
      409: "not_an_idea, not_a_build, too_long (the joined note passes the limit) or has_comments: the idea has comments or reactions, which stay with it.",
    },
  },
  "POST /items/:id/unmove": {
    summary: "Undoes a move: the idea comes back with its note and photos. People only.",
    body: unmoveInto,
    response: one("item", Item),
    errors: { 404: notFound("idea") },
  },
  "POST /items/:id/restore": {
    summary: "Restores a deleted item.",
    response: one("item", Item),
    errors: { 404: notFound("item") },
  },
  "PUT /items/:id/photos/order": {
    summary: "Sets the order of an item's photos; the first is the cover.",
    body: reorder,
    response: one("item", Item),
  },
  "PUT /items/:id/photos/:photoId": {
    summary: "Uploads a photo to an item; the client picks the photo id, so a retry is safe.",
    multipart: { fields: itemPhotoFields, files: photoFiles, required: ["large", "thumb"] },
    response: one("photo", Photo),
    status: 201,
    errors: { 413: "too_large: over 12 MB.", 415: "unsupported: not WebP or JPEG." },
  },
  "POST /items/:id/attempts": {
    summary: "Starts a print attempt on a build, with its settings.",
    body: createAttempt,
    response: one("attempt", Attempt),
    status: 201,
    errors: { 404: notFound("build") },
  },

  // Wishlists: everyone reads them; each person changes only their own, and only as a person.
  "GET /wishlists": {
    summary: "Everyone's wishlist of top ideas, yours first; a private one comes with no entries.",
    response: list("wishlists", Wishlist),
  },
  "PUT /wishlists/me/items/:itemId": {
    summary: "Puts an idea on your wishlist, at the end or at `position`; adding it again changes nothing.",
    body: addToWishlist,
    response: one("wishlist", Wishlist),
    errors: {
      404: notFound("idea"),
      409: "not_an_idea: it is a build now; full: the list holds 50.",
    },
  },
  "DELETE /wishlists/me/items/:itemId": {
    summary: "Takes an idea off your wishlist.",
    response: one("wishlist", Wishlist),
  },
  "PUT /wishlists/me/order": {
    summary: "Sets your wishlist's order: these first, in this order; the rest keep their turn after them.",
    body: wishlistOrder,
    response: one("wishlist", Wishlist),
  },
  "PATCH /wishlists/me": {
    summary: "Shares your wishlist with the others who sign in (the default) or keeps it private.",
    body: updateWishlist,
    response: one("wishlist", Wishlist),
  },

  // The idea scout: agents may read the suggestions, never act on them.
  "GET /scout": {
    summary:
      "This week's three suggested models from the idea scout (state thinking, ready or none), each with its link, title, why it fits and whether it was kept or dismissed. Read-only for agents.",
    response: any("The week's suggestions.", { scout: z.looseObject({}) }),
    errors: { 404: "not_found: the idea scout isn't set up." },
  },
  "GET /scout/:id/picture": {
    summary: "A suggested model's picture.",
    response: "binary",
    errors: { 404: notFound("picture") },
  },
  "PUT /scout/:id/keep": {
    summary:
      "Keeps a suggested model: it becomes an idea (the client picks its id) and Claude drafts the rest from its link. People only.",
    body: scoutKeepBody,
    response: any("The suggestion, now kept.", { pick: z.looseObject({}) }),
    errors: { 404: notFound("suggestion"), 409: "decided: it was answered already." },
  },
  "DELETE /scout/:id/keep": {
    summary: "Undo for Keep: the idea it made goes to the bin and the suggestion is waiting again. People only.",
    response: any("The suggestion.", { pick: z.looseObject({}) }),
  },
  "PUT /scout/:id/dismiss": {
    summary: '"Not for us": the scout never suggests that model again. People only.',
    response: any("The suggestion, now dismissed.", { pick: z.looseObject({}) }),
  },
  "DELETE /scout/:id/dismiss": {
    summary: "Undo for dismissing: the suggestion is waiting again. People only.",
    response: any("The suggestion.", { pick: z.looseObject({}) }),
  },

  // Comments.
  "GET /items/:id/comments": {
    summary: "The thread under an idea or build, oldest first, and how far you have read.",
    response: any("The thread.", { comments: z.array(z.looseObject({})), readAt: z.number().nullable() }),
  },
  "POST /items/:id/comments": {
    summary: "Writes a comment; the client picks the id, so a retry is safe.",
    body: createComment,
    response: one("comment", z.looseObject({})),
    status: 201,
  },
  "POST /items/:id/comments/read": {
    summary: "Marks the thread read for you.",
    response: z.object({ readAt: z.number() }),
  },
  "GET /comments/unread": {
    summary: "Threads with comments you haven't read.",
    response: any("Unread threads.", { threads: z.array(z.looseObject({})) }),
  },
  "PATCH /comments/:id": {
    summary: "Edits your own comment.",
    body: updateComment,
    response: one("comment", z.looseObject({})),
    errors: { 403: "not_yours: someone else wrote it." },
  },
  "DELETE /comments/:id": { summary: "Deletes your own comment (it can be restored).", response: "empty", status: 204 },
  "POST /comments/:id/restore": {
    summary: "Brings a deleted comment back.",
    response: one("comment", z.looseObject({})),
  },

  // Reactions: people only.
  "GET /reactions/used": {
    summary: "The emoji most used on reactions and the ones you used last (the picker's quick row).",
    response: emojiUse,
  },
  "PUT /items/:id/reactions/:kind": {
    summary: `Gives your reaction to an idea or build (your own too); ${reactionEmoji}.`,
    response: reactionsAnswer,
    errors: { 400: "invalid: a reaction is one emoji." },
  },
  "DELETE /items/:id/reactions/:kind": {
    summary: "Takes your reaction back.",
    response: reactionsAnswer,
    errors: { 400: "invalid: a reaction is one emoji." },
  },
  "PUT /comments/:id/reactions/:kind": {
    summary: `Gives your reaction to a comment (your own too); ${reactionEmoji}.`,
    response: reactionsAnswer,
    errors: { 400: "invalid: a reaction is one emoji." },
  },
  "DELETE /comments/:id/reactions/:kind": {
    summary: "Takes your reaction to a comment back.",
    response: reactionsAnswer,
    errors: { 400: "invalid: a reaction is one emoji." },
  },

  // Attempts and files.
  "PATCH /attempts/:id": {
    summary: "Changes an attempt: outcome, note, tags, settings (whole, or `settingsMerge` for some), parts.",
    body: updateAttempt,
    response: one("attempt", Attempt),
    errors: { 404: notFound("attempt") },
  },
  "POST /attempts/:id/finish": {
    summary: "Finishes a print with an outcome; safe to repeat, and keeps someone else's outcome.",
    body: finishAttempt,
    response: z.object({ attempt: Attempt, finished: z.boolean() }),
    errors: { 404: notFound("attempt") },
  },
  "PUT /attempts/:id/coach/:suggestionId": {
    summary: "Dismisses one of Claude's suggestions for the next try, or takes the dismissal back. People only.",
    body: z.object({ dismissed: z.boolean() }),
    response: one("attempt", Attempt),
  },
  "DELETE /attempts/:id": { summary: "Deletes an attempt (it can be restored).", response: "empty", status: 204 },
  "POST /attempts/:id/restore": { summary: "Restores a deleted attempt.", response: one("attempt", Attempt) },
  "PUT /attempts/:id/file": {
    summary:
      "Attaches the file an attempt was printed from, with its plate thumbnail: a slicer file, or a model (kind model: an .stl or plain .3mf the app slices).",
    multipart: {
      fields: fileFields,
      files: {
        file: "The .3mf or .gcode.3mf, kept up to 25 MB; a model's .stl or .3mf, required, up to 50 MB.",
        thumb: "The plate's picture.",
      },
    },
    response: one("attempt", Attempt),
    errors: { 404: notFound("attempt"), 415: "unsupported: not a slicer file." },
  },
  "DELETE /attempts/:id/file": {
    summary: "Removes an attempt's slicer file (it can be restored).",
    response: "empty",
    status: 204,
  },
  "POST /attempts/:id/file/restore": { summary: "Brings the slicer file back.", response: one("attempt", Attempt) },
  "PUT /items/:id/files/:fileId": {
    summary:
      "Keeps a file with an idea or build, with its plate thumbnail: a slicer file (.3mf or .gcode.3mf), or a model (kind model: an .stl or plain .3mf the app slices). Several may be kept; the same id again changes it.",
    multipart: {
      fields: fileFields.omit({ id: true }),
      files: {
        file: "The .3mf or .gcode.3mf, kept up to 25 MB; a model's .stl or .3mf, required, up to 50 MB.",
        thumb: "The plate's picture.",
      },
    },
    response: one("file", AttemptFile),
    errors: {
      404: notFound("idea"),
      409: "too_many: an idea keeps at most 20 files.",
      415: "unsupported: not a picture.",
    },
  },
  "DELETE /items/:id/files/:fileId": {
    summary: "Removes a file kept with an idea or build (it can be restored). People only.",
    response: "empty",
    status: 204,
  },
  "POST /items/:id/files/:fileId/restore": { summary: "Brings the file back.", response: one("file", AttemptFile) },
  "GET /files/:id/:part?": {
    summary:
      "A file's bytes (a model's original), its plate thumbnail with `/thumb`, or a model's sliced .gcode.3mf with `/sliced`.",
    response: "binary",
    errors: { 404: notFound("file") },
  },
  "PUT /files/:id/sliced": {
    summary:
      "Keeps how a model was sliced (or why it couldn't be), with the sliced .gcode.3mf and its plate picture. The app slices in the browser; slicing again replaces it.",
    multipart: {
      fields: slicedFields,
      files: {
        sliced: "The .gcode.3mf, up to 25 MB: required when slice.status is sliced.",
        thumb: "The plate's picture.",
      },
    },
    response: one("file", AttemptFile),
    errors: {
      404: notFound("file"),
      409: "conflict: only a model is sliced.",
      415: "unsupported: not a picture.",
    },
  },
  "PATCH /files/:id": {
    summary:
      "Sets the slicing settings people chose for a model (quality, strength, supports, brim, filaments, plate, nozzle, scale): what its next slice uses. Null puts the defaults back. People only.",
    body: fileChange,
    response: one("file", AttemptFile),
    errors: { 404: notFound("file"), 409: "conflict: only a model has slicing settings." },
  },
  "POST /files/:id/sliced/restore": {
    summary:
      "Undoes a re-slice: the slice it replaced comes back with its file, picture and settings. Once. People only.",
    response: one("file", AttemptFile),
    errors: { 404: notFound("file"), 409: "conflict: there is no slice before this one." },
  },

  // Spools.
  "GET /spools": { summary: "The pantry: every spool, with where it is loaded.", response: list("spools", Spool) },
  "POST /spools": {
    summary: "Adds a spool; the client picks the id, so a retry is safe.",
    body: createSpool,
    response: one("spool", Spool),
    status: 201,
  },
  "GET /spools/:id": { summary: "One spool.", response: one("spool", Spool), errors: { 404: notFound("spool") } },
  "PATCH /spools/:id": {
    summary: "Changes a spool: material, colour, level, note, drying.",
    body: updateSpool,
    response: one("spool", Spool),
  },
  "DELETE /spools/:id": { summary: "Deletes a spool (it can be restored).", response: "empty", status: 204 },
  "POST /spools/:id/restore": { summary: "Restores a deleted spool.", response: one("spool", Spool) },
  "PUT /spools/:id/weight": {
    summary: "Sets what a spool held when new and what the empty spool weighs, for tracking in grams.",
    body: weightBody,
    response: one("spool", Spool),
  },
  "POST /spools/:id/weighings": {
    summary: "Records a weighing: a fresh baseline for the grams left.",
    body: weighBody,
    response: one("spool", Spool),
    status: 201,
  },
  "DELETE /spools/:id/weighings/:weighingId": { summary: "Takes a weighing back.", response: "empty", status: 204 },
  "GET /spools/:id/usage": {
    summary: "What used a spool, and its weighings.",
    response: any("Usage and weighings.", { usage: z.array(z.looseObject({})), weighings: z.array(z.looseObject({})) }),
  },
  "PUT /spools/:id/photo/:photoId": {
    summary: "Sets a spool's photo (usually the label).",
    multipart: { fields: spoolPhotoFields, files: photoFiles, required: ["large", "thumb"] },
    response: one("spool", Spool),
  },
  "POST /spools/:id/label-read": {
    summary:
      "Has Claude read the label in the spool's photo (people only; 404 without the key). Answers at once; the spool fills in through the change feed and `fromLabel` lists what it filled.",
    body: readLabelBody,
    response: one("spool", Spool),
    errors: { 400: "invalid: there is no photo yet.", 404: notFound("spool") },
  },
  "POST /spools/:id/label-read/accept": {
    summary: "Confirms the several spools a label photo showed: the first fills this spool, the rest are added.",
    response: z.object({ spool: Spool, created: z.array(Spool) }),
    status: 201,
    errors: { 404: "not_found: nothing from the label is waiting." },
  },
  "DELETE /spools/:id/label-read": {
    summary: "Puts away a label read that is waiting for a tap or didn't work out.",
    response: one("spool", Spool),
  },
  "GET /spools/:id/attempts": {
    summary: "The attempts that were printed from a spool.",
    response: any("Attempts.", { attempts: z.array(z.looseObject({})) }),
  },

  // Recipes.
  "GET /recipes": {
    summary: "Recipes (named settings that worked), newest first; `material` and `finish` narrow to what fits a spool.",
    query: recipeQuery,
    response: list("recipes", z.looseObject({})),
  },
  "POST /recipes": {
    summary: "Saves an attempt that worked as a recipe.",
    body: createRecipe,
    response: one("recipe", z.looseObject({})),
    status: 201,
    errors: { 404: notFound("attempt"), 422: "not_worked or no_material: it must have worked and name a filament." },
  },
  "PATCH /recipes/:id": {
    summary: "Renames a recipe or changes its note.",
    body: updateRecipe,
    response: one("recipe", z.looseObject({})),
  },
  "DELETE /recipes/:id": { summary: "Deletes a recipe (it can be restored).", response: "empty", status: 204 },
  "POST /recipes/:id/restore": { summary: "Restores a deleted recipe.", response: one("recipe", z.looseObject({})) },

  // Twists.
  "GET /twists": {
    summary: "Twists (models we print our own way), newest first.",
    response: list("twists", z.looseObject({})),
  },
  "GET /twists/:id": {
    summary: "One twist.",
    response: one("twist", z.looseObject({})),
    errors: { 404: notFound("twist") },
  },
  "POST /twists": {
    summary:
      "Makes a twist, usually from an idea (`fromItemId`): its model link, title and cover come along unless given.",
    body: createTwist,
    response: one("twist", z.looseObject({})),
    status: 201,
    errors: { 404: notFound("idea or recipe") },
  },
  "PATCH /twists/:id": {
    summary: "Changes a twist's name, note, source, recipe or its whole list of changes.",
    body: updateTwist,
    response: one("twist", z.looseObject({})),
  },
  "DELETE /twists/:id": { summary: "Deletes a twist (it can be restored).", response: "empty", status: 204 },
  "POST /twists/:id/restore": { summary: "Restores a deleted twist.", response: one("twist", z.looseObject({})) },

  // The shopping list.
  "GET /shopping-items": {
    summary: "The shopping list: what's still to buy in its order, then what was bought, the latest first.",
    response: list("shoppingItems", z.looseObject({})),
  },
  "POST /shopping-items": {
    summary: "Adds something to buy (a name, a shop link or both) at the top of the list.",
    body: createShoppingItem,
    response: one("shoppingItem", z.looseObject({})),
    status: 201,
    errors: { 409: "deleted: that id was taken off the list.", 422: "too_many: the list is full." },
  },
  "PUT /shopping-items/order": {
    summary: "Orders what's still to buy: the named things trade places in this order; the rest stay put.",
    body: shoppingOrder,
    response: list("shoppingItems", z.looseObject({})),
  },
  "PATCH /shopping-items/:id": {
    summary: "Renames it, changes its shop or Prisjakt link, or ticks it off (`bought`) or back on.",
    body: updateShoppingItem,
    response: one("shoppingItem", z.looseObject({})),
  },
  "DELETE /shopping-items/:id": {
    summary: "Takes something off the list (it can be restored).",
    response: "empty",
    status: 204,
  },
  "POST /shopping-items/:id/check-prices": {
    summary:
      "Reads its Prisjakt product page again now: the picture and the cheapest offers, as found at that time. A check a moment ago stands.",
    response: one("shoppingItem", z.looseObject({})),
  },
  "POST /shopping-items/:id/suggest": {
    summary:
      "Looks for its Prisjakt page again, in a search engine's results (Claude's web search; `404` without the key, a daily cap). The answer is a `suggestion` to confirm, never a link that is used.",
    response: one("shoppingItem", z.looseObject({})),
  },
  "POST /shopping-items/:id/suggestion/dismiss": {
    summary: '"Not this one": drops the suggested Prisjakt page so it isn\'t suggested again.',
    response: one("shoppingItem", z.looseObject({})),
  },
  "GET /shopping-items/:id/picture": {
    summary: "Its picture (from its Prisjakt page, else its shop's page), when it has one.",
    response: "binary",
  },
  "POST /shopping-items/:id/restore": {
    summary: "Puts something taken off the list back.",
    response: one("shoppingItem", z.looseObject({})),
  },

  // The printer.
  "GET /printer/upkeep": {
    summary: "Upkeep tasks and what is due.",
    response: any("Tasks.", { printHours: z.number(), tasks: z.array(z.looseObject({})) }),
  },
  "POST /printer/upkeep": {
    summary: "Adds an upkeep task.",
    body: createTask,
    response: one("task", z.looseObject({})),
    status: 201,
  },
  "PATCH /printer/upkeep/:id": {
    summary: "Changes an upkeep task.",
    body: updateTask,
    response: one("task", z.looseObject({})),
  },
  "DELETE /printer/upkeep/:id": {
    summary: "Deletes an upkeep task (it can be restored).",
    response: "empty",
    status: 204,
  },
  "POST /printer/upkeep/:id/restore": { summary: "Restores an upkeep task.", response: one("task", z.looseObject({})) },
  "POST /printer/upkeep/:id/done": {
    summary: "Logs that a task was done.",
    body: logBody,
    response: one("task", z.looseObject({})),
    status: 201,
  },
  "PUT /printer/upkeep/logs/:logId/photo/:photoId": {
    summary: "Adds a photo to an upkeep log.",
    multipart: { fields: upkeepPhotoFields, files: photoFiles, required: ["large", "thumb"] },
    response: one("task", z.looseObject({})),
  },
  "DELETE /printer/upkeep/logs/:logId": { summary: "Removes an upkeep log entry.", response: "empty", status: 204 },
  "GET /printer": {
    summary: "The printer's setup, what is loaded in each AMS slot, and the bridge's status.",
    response: any("The printer.", {
      setup: z.looseObject({}),
      slots: z.record(z.string(), z.string()),
      bridge: z.looseObject({}).nullable(),
    }),
  },
  "PUT /printer": {
    summary: "Changes the printer's setup (nozzles, plates); what isn't sent is kept.",
    body: setupSchema,
    response: any("The printer."),
  },
  "PUT /printer/bridge": {
    summary: "The printer bridge's heartbeat: progress, unknown trays, its version and what is wrong.",
    body: bridgeSchema,
    response: any("The printer."),
  },
  "DELETE /printer/bridge": {
    summary: "Disconnects the printer bridge: its tokens end and its status is forgotten.",
    response: any("The printer."),
  },
  "POST /bridge/pairing": {
    summary: "Makes a short-lived, single-use code (about ten minutes) for the bridge's installer on a Mac.",
    response: z.object({ code: z.string(), expiresAt: z.number().int() }),
    status: 201,
    errors: { 429: "rate_limited." },
  },
  "POST /bridge/pair": {
    summary: "The installer's exchange of a pairing code for the bridge's token (scopes read, attempts, printer).",
    body: z.object({ code: z.string() }),
    response: z.object({
      token: z.string(),
      agentId: z.string(),
      appUrl: z.string(),
      scopes: z.array(z.string()),
    }),
    errors: { 410: "code_gone: used or expired.", 429: "rate_limited." },
    public: true,
  },
  "PUT /printer/slots/:slot": {
    summary: "Loads a spool into an AMS slot, or empties it.",
    body: setSlot,
    response: any("The printer."),
  },

  // Photos.
  "GET /photos/:id/:variant": {
    summary: "A photo's bytes: `large` or `thumb`.",
    response: "binary",
    errors: { 404: notFound("photo") },
  },
  "POST /photos/:id/resize-claim": {
    summary: "Claims resizing a photo that arrived without a browser, so two devices don't both do it.",
    response: z.object({ claimed: z.boolean() }),
  },
  "DELETE /photos/:id": { summary: "Deletes a photo (it can be restored).", response: "empty", status: 204 },
  "POST /photos/:id/restore": { summary: "Restores a deleted photo.", response: one("photo", Photo) },

  // Tags, the journal, search.
  "GET /tags": {
    summary: "The failure tags and success notes people added.",
    response: list("tags", z.object({ kind: z.string(), slug: z.string(), label: z.string() })),
  },
  "POST /tags": {
    summary: "Adds a tag; adding one that exists returns it.",
    body: createTag,
    response: one("tag", z.object({ kind: z.string(), slug: z.string(), label: z.string() })),
    status: 201,
  },
  "GET /journal": {
    summary: "The journal: what happened, newest first, 30 entries at a time.",
    query: journalQuery,
    response: any("A page of entries.", {
      entries: z.array(z.looseObject({})),
      items: z.array(Item),
      next: z.string().nullable(),
    }),
  },
  "GET /journal/summary": {
    summary: "A month of the journal at a glance.",
    query: summaryQuery,
    response: any("The summary.", { summary: z.looseObject({}) }),
  },
  "GET /insights": {
    summary: "The year so far, worked out from attempts.",
    query: insightsQuery,
    response: any("The year.", { insights: z.looseObject({}) }),
  },
  "GET /weeks/:monday": {
    summary:
      "One week (Monday to Sunday, the workspace's time zone): its prints and how they went, builds finished, ideas, comments, filament used, what is waiting, and Claude's paragraph when there is one.",
    response: any("The week.", { week: z.looseObject({}) }),
    errors: { 400: "invalid: not a Monday, as YYYY-MM-DD." },
  },
  "GET /links/preview": {
    summary: "The title and site of a public web page.",
    response: any("The page.", { url: z.string(), title: z.string().nullable(), site: z.string().nullable() }),
    errors: { 400: "invalid: not a public https link." },
  },
  "GET /builds/:id/story.md": {
    summary: "A build's story as markdown: attempts, what changed, comments.",
    response: "markdown",
    errors: { 404: notFound("build") },
  },
  "GET /search": {
    summary: "Searches builds, ideas, attempts, recipes and twists.",
    query: searchQuery,
    response: any("Results by kind.", {
      builds: z.array(z.looseObject({})),
      ideas: z.array(z.looseObject({})),
      attempts: z.array(z.looseObject({})),
      recipes: z.array(z.looseObject({})),
      twists: z.array(z.looseObject({})),
    }),
  },
  "GET /facets": {
    summary: "The materials and tags to filter the journal and search by.",
    response: any("Facets.", { materials: z.array(z.looseObject({})), tags: z.array(z.looseObject({})) }),
  },
  "GET /what-worked": {
    summary: "What worked before for this build and material: attempts and recipes.",
    query: whatWorkedQuery,
    response: any("Matches.", { matches: z.array(z.looseObject({})), recipes: z.array(z.looseObject({})) }),
  },
};
