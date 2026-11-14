# Colour matching (issue #313)

A model that arrives with colours of its own shows how it would print in our filaments, lets us choose which filament prints each colour, and slices that way. This is the plan, in the order the pull requests land.

## What a person sees

**Where it lives.** In "Slice with…", in the Filament section, where filament is already chosen: phone sheet and desktop side panel alike. A model with one colour (or none, like every STL) sees today's section. A model with two or more colours sees a **Colours** block above the filament line: one row per colour, the model's colour on the left (a swatch, the file's name for it, "3 parts"), an arrow, and the filament that will print it on the right (the spool's swatch, "Bambu PLA Basic · Orange"). No wizard: simplifying and matching happen on their own, and the rows are the result, ready to change.

```
Colours                         Show the model's own colours
  ● Ketchup Red   3 parts  →  ● Bambu PLA Red          ›
  ● Mustard       2 parts  →  ● Polymaker Yellow        ›
  ● Lettuce       1 part   →  ◌ Green · not in the Pantry yet   ›
  ● Cream + Ivory 3 parts  →  ● Bambu PLA Ivory          ›
```

**Simplify.** Near colours merge (Ketchup and Tomato Red are one), down to as many filaments as the printer takes (8 with the AMS). A merged row says so ("Cream + Ivory"). No slider: if there are more colours than slots, the nearest pairs merge until they fit.

**Match.** Each row starts on the Pantry spool nearest the colour, measured in OKLab (how far apart two colours look). A tap on the row opens the Pantry's spools as swatches to pick another. When nothing is close, the row holds a stand-in in the model's own colour, marked "not in the Pantry yet".

**Before and after.** The plate picture on the card has a quiet two-state switch, "In our filaments" and "Model's colours": on a phone it sits under the picture, on a desktop it is the same switch, and holding the key `C` peeks at the original. The 3D view gets the same switch once the 3D view's work (PR #315) has landed.

**Kept.** The choices are part of the model's slicing settings (`slicing.colours`), so a re-slice and a reprint keep them. "Back to the usual settings" clears them.

## Steps

1. **Read the colours** (no UI): the 3MF core's `basematerials` (`displaycolor`, `name`) assigned to objects (and inherited by their components), and in a Bambu or Orca project the colour of the filament each object or part prints in. They arrive on `ModelObject.colours` as runs of triangles. Colours on single triangles (`colorgroup`) and painted colours stay out.
2. **Simplify and match** (pure, `shared/slicing/colours.ts`): groups, merging, nearest spool, stand-ins; the choices in the slicing settings; the rows in the Filament section.
3. **Slice with them**: each object (or part) prints in its matched filament, through the parts path of PR #305 for ours; OrcaSlicer's engine takes one filament per object, which covers these models. The estimate and grams per filament follow.
4. **Preview**: the card's model picture in matched colours with the switch; the 3D view after PR #315.
