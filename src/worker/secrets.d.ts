/** Secrets are set with `wrangler secret put` (or .dev.vars), so `wrangler types` doesn't know them. */
interface Env {
  /** The raw 32-byte VAPID private key, base64url (pnpm vapid:generate). Absent: no push is sent. */
  VAPID_PRIVATE_KEY?: string;
}
declare namespace Cloudflare {
  interface Env {
    VAPID_PRIVATE_KEY?: string;
  }
}
