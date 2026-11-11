/** Secrets are set with `wrangler secret put` (or .dev.vars), so `wrangler types` doesn't know them. */
interface Env {
  /** The raw 32-byte VAPID private key, base64url (pnpm vapid:generate). Absent: no push is sent. */
  VAPID_PRIVATE_KEY?: string;
  /** Claude drafting ideas from model pages (docs/decisions/0019). Absent: the feature is hidden. */
  ANTHROPIC_API_KEY?: string;
  /** Webhook secrets are kept encrypted under a key derived from this (decision 0025). Absent: webhooks are off. */
  WEBHOOK_SECRET_KEY?: string;
  /** "off" stops a write from starting a delivery pass (the tests only). */
  WEBHOOKS_ON_WRITE?: string;
  /** Only the e2e tests and screenshots set this: webhooks may go to http://127.0.0.1 (a stand-in receiver). Never set it for real. */
  WEBHOOKS_ALLOW_LOCAL?: string;
  /** Only the e2e tests and screenshots set this: a stand-in for api.anthropic.com. */
  ANTHROPIC_BASE_URL?: string;
}
declare namespace Cloudflare {
  interface Env {
    VAPID_PRIVATE_KEY?: string;
    ANTHROPIC_API_KEY?: string;
    ANTHROPIC_BASE_URL?: string;
    WEBHOOK_SECRET_KEY?: string;
    WEBHOOKS_ALLOW_LOCAL?: string;
    WEBHOOKS_ON_WRITE?: string;
  }
}
