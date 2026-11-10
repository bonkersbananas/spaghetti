# 0014. The MCP server is hand-written, stateless and calls the API

Status: Accepted

**Decision:** `/mcp` is a small hand-written JSON-RPC handler for MCP over Streamable HTTP (`initialize`, `ping`, `tools/list`, `tools/call`), answering every POST with JSON. No sessions, no streams, no Durable Objects, no OAuth (agent bearer tokens only). Its tools call Spaghetti's own API with the caller's token instead of reaching into the database.

**Why:** the official SDK drags in a Node-oriented dependency tree and validates tool input with a schema compiler that generates code at runtime, which Workers forbid; the part of the protocol we need is five methods. Going through the API means scopes, validation, the "via" attribution and the change feed are the same for every way in, with nothing to keep in step.

**Consequences:** a tool is only as capable as its route (a new route needs a scope in `auth/scopes.ts` first). Clients that require OAuth can't connect until it is built (later work, on the roadmap). If MCP features that need a stream (server-initiated messages) become necessary, revisit, probably with the SDK's web-standard transport.
