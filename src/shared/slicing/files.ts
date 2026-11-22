/** Telling model files (.stl, plain .3mf) from slicer files by name, and naming what slicing makes of them. */

/** An .stl: always a model. A .3mf may be either, which only its contents tell (a sliced one has G-code). */
export const isStlName = (name: string) => /\.stl$/i.test(name);

/** "Benchy.stl" → "Benchy.gcode.3mf": the name a model's sliced file goes by. */
export function slicedName(name: string): string {
  return `${
    cleanFileName(name)
      .replace(/\.(stl|3mf)$/i, "")
      .trim() || "model"
  }.gcode.3mf`;
}

/**
 * The plate a model's sliced file has its G-code on. Spaghetti slices one plate of a model (a project's plate 2 of
 * 6, say) into a file of one plate, `Metadata/plate_1.gcode` (gcode3mf.ts), as Orca's own export does.
 */
export const SLICED_PLATE = 1;

/**
 * The plate to read in the file the 3D view opens: a model's sliced file has one plate, whichever of the project's it
 * was (`plate` names that one); a slicer file someone added keeps its plates as they are.
 */
export function viewerPlate(file: { kind?: string; plate: number }): number {
  return file.kind === "model" ? SLICED_PLATE : file.plate;
}

/**
 * A file's name without the marks Finder and browsers add to copies: "marshmellow (1).3mf" → "marshmellow.3mf",
 * "x.gcode (3) copy.3mf" → "x.gcode.3mf". Double extensions stay. A "-2" goes only straight after a known
 * extension ("x.gcode-2.3mf"); "bracket-v2" and "m3-8" are names, not copies.
 */
export function cleanFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || !/^\.[A-Za-z0-9]{1,8}$/.test(name.slice(dot))) return name;
  let base = name.slice(0, dot);
  const extension = name.slice(dot);
  for (;;) {
    const next = base
      .replace(/\s*\(\d+\)$/, "")
      .replace(/\s+copy(\s+\d+)?$/i, "")
      .replace(/(\.(?:gcode|3mf|stl))-\d+$/i, "$1");
    if (next === base) break;
    base = next;
  }
  base = base.trim();
  return base ? `${base}${extension}` : name;
}
