# 0063. Copies of a model print as separate objects

Status: Accepted

**Decision:** "Slice with…" can print several copies of a model's plate together (issue #366): a number from 2 to 99, or "as many as fit". The count is the model's own setting (`copies`, kept beside `modelPlate`, carried by recipes) and the slice records how many there were. Each copy of each object is its own object in the file both slicers get, named "Key tag (2)", so Bambu Studio's and the printer's "skip objects" list every one. The copies are arranged with the same shelf packing as any plate (6 mm apart, rows centred); with two filaments or more, room is kept at the plate's right for the prime tower, wherever a project had put it. Colours, a project's plate and painted supports copy with the object.

**Why:** Carl Oscar wants to print a small thing many times in one go, as in Bambu Studio, and to cancel one failed copy without losing the plate.

**Consequences:** Copies of the plate's objects only; copies of single objects can come later. A count that doesn't fit fails as "too many" with how many would (`fitCopies`). slicer-rs needed nothing new: it slices each object it is given.
