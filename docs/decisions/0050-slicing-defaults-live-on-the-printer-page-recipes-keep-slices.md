# 0050. The workspace's slicing defaults live on the Printer page, and recipes keep the slicing that worked

Status: Accepted

**Decision:** How a model nobody set up is sliced in this workspace is set on the Printer page, in a Slicing section with the same choices as a model's settings (decision 0049): quality, strength, supports and, under More, the kind of supports, the brim, walls, infill and pattern. They are kept with the printer's setup (`setup.slicing`, `PUT /api/printer`, null for Spaghetti's own), and only how a model prints: the filament still comes from the Pantry (the first loaded spool), the plate and nozzle from the rest of the setup, and each model keeps its own settings once someone changes them on its card. A recipe (decision 0017) saved from an attempt whose model Spaghetti sliced also keeps the slicing settings it was sliced with (`recipe.slicing`, the kind of filament and not the spool), read by the Worker from the attempt's file, as its other settings are. A model's settings offer recipes at the top, those for its filament first ("From a recipe"): one tap slices it the way the recipe says, whole when the recipe kept a slice's settings, else from the attempt's settings it kept (layer height, walls, infill, supports, brim, plate, nozzle, filament), with the model's own size, and the spool already picked when it is the same kind of filament, else one from the Pantry.

**Why:** Carl Oscar asked (Nov 13) for a workspace default and for recipes to slice with and to keep what worked. The Printer page is where the setup that every print shares already lives (plates, nozzles), and a whole Settings screen for one section would be one more place to look. Recipes are already the app's way to say "this is how we print silk PLA now": slicing settings are one more thing they keep, not a second recipe system.

**Consequences:**

- A recipe from a slicer's own file, or older than this, slices with what its attempt's settings say; its slicing settings stay null.
- The defaults change what models nobody set up are sliced with next, not the slices already made.
- The section is a chunk of its own that the Printer page loads once it has settled, and it loads the settings sheet's code in turn: the page's first load carries only a skeleton of its tiles (0.2 kB).
