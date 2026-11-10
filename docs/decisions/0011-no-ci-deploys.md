# 0011. No CI deploys

Status: Accepted

**Decision:** GitHub Actions builds, tests and smoke-tests the container image but never deploys. The Cloudflare API token lives in fctl's project secrets, not in GitHub's, and deploys are run by hand from a session with `pnpm ship`.

**Why:** a deploy token in GitHub would let any workflow run publish to production. Keeping it out limits who and what can ship.

**Consequences:** no deploy job in `.github/workflows`, and no Cloudflare secrets in the repository's settings. Migrations to the remote database are applied by whoever deploys (`wrangler d1 migrations apply DB --remote`).
