# 0068. Back goes to where a detail page was opened from

Status: Accepted

**Decision:** The back control at the top of an idea, build, twist or spool page, its Escape key and the phone's pull down from the top go back to the page it was opened from in the app (the Journal, Today, Search, Wishlists, the Pantry, another idea…), as it was left (a step back in history, so its scroll, filters and search come back), and the control names that page (its heading; when the pages own title starts with that name, as a twist made from an idea does, the kind of page instead: "Idea"). A page opened directly (a shared link, a new tab, a reload, a tapped notification) goes to its list as before. Steps within the same thing keep where it came from: picking an attempt, a photo or the 3D view, J and K, and an idea that becomes a build. Twists and spools have the same pull down as ideas and builds.

**Why:** Carl Oscar, Nov 16: "When going into an idea or build from the journal, the back (top left) should take me back to Journal not to Ideas or Builds", and the same day the twist page's missing pull down.

**Consequences:** `lib/previous-path.ts` (in every first load, so it only writes down) records how each history entry was reached and where each was scrolled; `lib/origin.ts` (with the detail pages) reads it: `useBackTo(list)` for the control, Escape and pull-to-go. The name is the page's heading as it was left. Nothing is kept across a reload, by design. A step back also sets the page's scroll again once it is drawn: the back slide's view transition draws it after the router has restored the position.
