/**
 * Public links (decision 0075): an idea, a build or a twist that anyone with the link can look at, read-only,
 * without signing in. A link is a capability: `/s/<token>`, where the token is 18 random bytes (144 bits) in
 * base64url. It shows that one thing and nothing else, and stops the moment it is revoked or the thing is deleted.
 */

/** Which table a public link points into: items (ideas and builds) or twists. */
export const SHARE_KINDS = ["item", "twist"] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

/** Random bytes in a token: 144 bits, 24 characters of base64url with no padding. */
export const SHARE_TOKEN_BYTES = 18;
/** What a token looks like; anything else is answered as an unknown link without a lookup. */
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{24}$/;

/** The guest page's path, under the app's own origin. */
export const sharePath = (token: string) => `/s/${token}`;

/** A live public link, as the two people see it (GET /api/shares). Person-only: the token is the link's secret. */
export interface Share {
  id: string;
  kind: ShareKind;
  /** The item's or twist's id. */
  targetId: string;
  token: string;
  /** The person who made the link. */
  createdBy: string;
  createdAt: number;
}

/** GET /api/shares: every live public link, newest first. */
export interface SharesResponse {
  shares: Share[];
}

/** PUT /api/shares/:kind/:id, POST /api/shares/:id/restore. */
export interface ShareResponse {
  share: Share;
}
