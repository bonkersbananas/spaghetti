# 0032. A landing page at the root for visitors, the app for the two people

Status: Accepted

**Decision:** spaghetti.day/ is a bright landing page for anyone signed out, with Sign in on it, and the app for anyone signed in. It is a static page of its own (landing.html, src/landing), never a route of the app; it never offers sign-up or a waiting list. The two people in its pictures are M and CO, with their own pictures.

**Why:** the address was a sign-in form with no word on what Spaghetti is. A page that shows it off (photos of prints, the app on a phone and a laptop) costs the app nothing if it stays out of the app's code: the Worker picks the page by the session cookie's presence, so the app's first load, its service worker and its budgets are exactly what they were, and someone signed in never sees it.

**Consequences:** `/` reaches the Worker first (`run_worker_first`, src/worker/home.ts) and is never cached for one or the other (`Vary: Cookie`); the service worker fetches its app shell from /today and asks the network what `/` is. Deep links still go through sign-in and back; the Home Screen app starts at /today. Still no public sign-up ([0002](0002-two-people-no-sign-up.md)): the page says so. Its pictures are made by `pnpm landing:shots` from the screenshot seed and committed (docs/landing.md); refresh them when the app's screens change.
