# 0001. Cloudflare Workers, D1 and R2, running locally and in Docker on workerd

Status: Accepted

**Decision:** Spaghetti is one Cloudflare Worker (a Hono API plus the React app as static assets) with D1 for data and R2 for photos and slicer files. Until it is deployed, and for anyone who wants to host it themselves, it runs locally on workerd through wrangler/miniflare, also in a Docker container.

**Why:** two people don't need servers to look after, and Cloudflare's free tier covers them. Running the same Worker on workerd locally means development, tests and the container behave like production.

**Consequences:** server code uses only what Workers offer: no Node-only modules, no file system, no native libraries (see [0004](0004-photos-resized-in-the-browser.md)). A new storage need is a binding in `wrangler.jsonc`. Local and container runs must keep working without a Cloudflare account.
