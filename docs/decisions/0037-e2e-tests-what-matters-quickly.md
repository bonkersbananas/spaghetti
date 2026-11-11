# 0037. The end-to-end tests check what the two people use, quickly, and leave accessibility rules and timing out of pull requests

Status: Accepted

**Decision:** The Playwright suite runs on the production build with a server per worker. Every spec runs at desktop width. At phone width, only the core loop runs whole (signing in and the tab bar, capture, a build and its attempts, Today, every screen and sheet opening), plus the tests tagged `@phone`. axe and other accessibility-only checks don't run any more. The timing tests (taps, the installed app opening, scrolling a hundred photos) run only on pushes to main, in a job of their own. A pull request is held to a screen's first-load ceiling only where it made that screen heavier than main.

**Why:** A CI run took 16 to 22 minutes and nine jobs, under a limit of 20 jobs at once for the organization, so agents waited half an hour for an answer (Carl Oscar, Nov 11: make it efficient). Most specs ran the same steps at both widths. Carl Oscar said accessibility checks of their own aren't needed: the two people who use the app don't need those features, though they're welcome built in. Timing on shared runners failed runs that had nothing to do with speed. And with budgets 1 kB above main, unrelated pull requests failed on main's own size.

**Consequences:**
- A test that is only about a phone's layout (a sheet instead of a popover, touch, the tab bar) needs `{ tag: "@phone" }`, or it runs at desktop width alone. A new screen goes into `e2e/screens.spec.ts`.
- Building accessibly stays the rule (names from visible text, 44 px targets, 16 px fields, focus), but only the phone and keyboard details in `screens.spec.ts` are tested.
- A slow tap shows up on main after the merge, where a red Speed job holds the ship back.
- Revisit if a phone-only break slips through, or if more people start using the app.
