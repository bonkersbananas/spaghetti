/** Telling model files (.stl, plain .3mf) from slicer files by name, and naming what slicing makes of them. */

/** An .stl: always a model. A .3mf may be either, which only its contents tell (a sliced one has G-code). */
export const isStlName = (name: string) => /\.stl$/i.test(name);

/** "Benchy.stl" → "Benchy.gcode.3mf": the name a model's sliced file goes by. */
export function slicedName(name: string): string {
  return `${name.replace(/\.(stl|3mf)$/i, "").trim() || "model"}.gcode.3mf`;
}
