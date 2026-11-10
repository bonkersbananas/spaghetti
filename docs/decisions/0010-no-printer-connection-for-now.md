# 0010. No connection to the printer, for now

Status: Open (being decided)

**Decision (for now):** Spaghetti does not talk to the printer. People log attempts by hand or from the slicer file; nothing is read from or sent to the X2D.

**Why:** a connection means the local network, the printer's LAN mode and credentials, and a component that can't live on a Worker. It is also the easiest way to break [0003](0003-no-bambu-dependency.md) by accident.

**Consequences:** a read-only bridge on the home network (start and finish attempts, sync AMS slots, grab a camera frame) is on the [roadmap](../roadmap.md). If it is built it is optional, runs outside the Worker, and the app works without it. Don't add printer-protocol code to the Worker or the client.
