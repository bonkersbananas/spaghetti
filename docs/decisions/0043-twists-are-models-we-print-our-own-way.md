# 0043. A twist is another person's model, changed our way

Status: Accepted

**Decision:** The section for adapting existing models is called **Twists** (Carl Oscar's pick on Nov 12; "recipes" stays the name of an attempt's frozen print settings, [0017](0017-recipes-are-frozen-attempts.md)). A twist (`twists` table) is a name and note, the model's source (link, title, designer, licence, a picture from the idea it was made from), what we changed (`changes`: a list of a kind, a value and a few words, in the order people wrote it) and an optional recipe that says how to print it. It is made from an idea (the idea's model link, title and cover come along) or from nothing. The idea, photo and recipe ids are not foreign keys: a twist outlives them and the link goes quiet, as with recipes. Changes are words first: a change nothing in the app can apply is still worth keeping.

**Why:** the two of them often print someone else's model with changes (scaled to a 42 mm grid, 0.2 mm looser, a name added, another material) and want one place for them. A recipe answers "how do we print it", a twist "what do we print"; each stays small. The full plan is in [the proposal](../proposals/twists.md).

**Consequences:** `twists` has soft delete and restore (the undo toast), is purged with the rest after 30 days and writes `twist` changes to the feed. `POST` and `PATCH` are open to the `capture` scope, deletes are person-only. A twist's own file (an `.stl` or `.3mf`) is not part of this decision: [0013](0013-bambu-studio-and-orca-files-only.md) reads only Bambu and Orca files, so keeping plain `.stl` files needs its own record when that stage is built. Builds that printed a twist, search and the screens come in later pull requests.
