# 0017. A recipe is a named, frozen copy of an attempt that worked

Status: Accepted

**Decision:** a recipe (`recipes` table) is made from one attempt that worked and says which filament it used. The Worker reads the settings from the attempt itself (`recipeSettings`: the chosen settings, without results, grams, AMS slot or spool); the request carries only the name and note. People edit a recipe's name and note, never its settings: to change them, save a newer attempt as a recipe. The link back to the attempt and build is kept without foreign keys, so a recipe outlives them and the link just goes quiet. Recipes are matched to spools by material, and by finish when both the recipe and the spool have one; a recipe with no finish is for the material at large. A recipe's finish is the finish of the spool its attempt used, when it used one from the pantry.

**Why:** "what worked last time" should be something you keep and name, not dig out of a build's story. Frozen settings keep a recipe honest (it says what actually worked once), and a newer attempt is the natural way to improve one. Deleting a build must not take the way you print silk PLA with it.

**Consequences:** `recipes` has soft delete and restore like spools (the undo toast), is purged with the rest after 30 days, and writes `recipe` changes to the feed. `POST` and `PATCH` are open to the `attempts` scope, deletes are person-only like everything else. Recipes are found in search by a plain match over their name, note, material and finish in the Worker (there are few), not in the FTS index. Starting an attempt from a recipe is only a prefill: the attempt does not remember the recipe.
