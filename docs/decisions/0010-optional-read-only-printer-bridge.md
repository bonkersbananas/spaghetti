# 0010. An optional, read-only printer bridge

Status: Accepted (built: `bridge/`, see [docs/bridge.md](../bridge.md))

**Decision:** Carl Oscar chose to build a printer bridge: a small program on a home computer that listens to the X2D over the local network (LAN mode, local MQTT, FTP and the camera). It starts and finishes attempts, keeps the AMS slots in sync, and saves a camera frame as the attempt's photo. It is read-only: it never sends a command to the printer. It replaces the earlier "no connection to the printer, for now".

**Why:** the moments the journal cares about (a print starting, finishing, failing) are visible on the printer, so people shouldn't have to log them by hand. Keeping it local and read-only means it needs no Bambu account and can't interfere with a print.

**Consequences:** the bridge is optional and the app works fully without it ([0003](0003-no-bambu-dependency.md) stands: never Bambu's cloud, never a Bambu account). It runs outside the Worker, on the home network, and talks to the app's API like any other client (the roadmap's agent identities and scoped tokens fit it; see the [roadmap](../roadmap.md)); no printer-protocol code goes into the Worker or the client. Whatever it does must be possible by hand too. It is built: `pnpm bridge`, or its own Docker image, with `bridge/` in this repository. The one message it ever sends the printer is the status request `pushall`, so that the printer answers with its whole state; everything else is listening. It records a print's end and a suggested failure tag but never the outcome, which stays the person's call.
