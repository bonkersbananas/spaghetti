# 0015. Sharing in: a share target where the browser has one, a Shortcut on iPhone, a bookmarklet on desktop

Status: Accepted

**Decision:** Sharing into Spaghetti uses each device's own mechanism rather than one: a Web Share Target in the manifest (Android, desktop Chrome and Edge, answered by the service worker so it works offline), two iOS Shortcuts that post to `POST /api/capture` with a capture-only token (Safari has no share targets for web apps), and a bookmarklet for desktop browsers that opens the app's `/share` route.

**Why:** Capture must take under 10 seconds from anywhere, and ideas arrive while reading something else. Native apps and browser extensions are out of reach for a two-person web app; these three need nothing installed beyond the app itself.

**Consequences:** `/api/capture` is the one endpoint that takes a raw image body or a plain form, for tools that can't build the app's resized two-variant upload; its photos are `needsResize`. A shared link is only text in the note: nothing is fetched for it beyond the existing link card. The Shortcut's token has the `capture` scope only. Sharing to an idea that exists (rather than a new one) is not built.
