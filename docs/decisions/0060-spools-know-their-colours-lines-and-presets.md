# 0060. A spool knows its colours, its product line and the preset it slices with

Status: Accepted

**Decision:** The first twelve spools Carl Oscar and Marie ordered (Anycubic dual-colour silks, SUNLU's tri-colour, Polymaker's PolyTerra and Panchroma, Elegoo, and Bambu Lab's Matte, Silk+ and Pure) can be added the way their labels say them, are told apart at a glance, and slice with fitting presets.

- **Multi-colour is a kind, stored as colours.** A co-extruded spool (its colour shifts with the angle) has `colors`, two or three #rrggbb in order, and **no `colorHex`**: the server clears one when the other is set. That makes a multi-colour spool unmatchable as one colour by construction, so colour matching (`colours.ts`'s `matchColour`, `matchSpool`) skips it without knowing about it. It is drawn as a hard conic split (`SpoolDisc`), not a gradient.
- **A product line is its own field** (`line`: "PolyTerra", "Panchroma"), said before the material; the finish after it. "Silk+" and "Pure" are finishes (Bambu says them after "PLA"). `spoolLabel` reads like the label: "Polymaker PolyTerra PLA · Forest Green", "Anycubic PLA Silk · Black/Purple dual colour".
- **Brands read as makers spell them** (`brandLabel`: "Bambu" and "Bambu Lab" are Bambu Lab, "Sunlu" SUNLU), at display; saved values are not migrated.
- **Known products** (`shared/products.ts`) are one tap in the new-spool sheet and give the maker's nozzle and bed range, which a slice keeps the nozzle temperature inside.
- **Presets:** for Bambu's own spools, Bambu's PLA Matte, Silk and Silk+ presets (Pure has none for the X2D at the pinned Orca: it slices as Basic; where the engine's release has them: `pickFilamentPreset` falls through to the generic kind otherwise). Orca has no X2D preset for Polymaker, Elegoo, Anycubic or SUNLU, so those slice with Generic PLA, or Generic PLA Silk for the silks, never with Bambu's tuned matte. Both slicers get the setup from the same `sliceSetup`.
- **Left out:** a tip about cardboard spools. The product pages don't say what the spools are made of.
