/**
 * What the 3D view reads from a `.gcode.3mf` besides the plate's G-code: the slice's figures and filaments for one
 * plate (`Metadata/slice_info.config`) and the project's filament lists (`Metadata/project_settings.config`). The
 * viewer's reader (read-file.ts) and the shared page's toolpaths (worker/guest/toolpaths.ts, which rewrites both files
 * down to what is read here, decision 0077) use the same readers, so they can't drift apart.
 */

export interface SliceInfo {
  prediction?: number;
  filaments: Map<number, { color?: string; type?: string }>;
  nozzles?: number[];
}

/** The `<plate>` of slice_info.config that says `index = plate`, read with patterns (it is a small, regular file). */
export function parseSliceInfo(xml: string | undefined, plate: number): SliceInfo {
  const out: SliceInfo = { filaments: new Map() };
  if (!xml) return out;
  for (const block of xml.match(/<plate>[\s\S]*?<\/plate>/g) ?? []) {
    const index = /key="index"\s+value="(\d+)"/.exec(block)?.[1];
    if (Number(index) !== plate) continue;
    const prediction = Number(/key="prediction"\s+value="([\d.]+)"/.exec(block)?.[1]);
    if (prediction > 0) out.prediction = Math.round(prediction);
    const maps = /key="filament_maps"\s+value="([\d\s]+)"/.exec(block)?.[1];
    if (maps) out.nozzles = maps.trim().split(/\s+/).map(Number);
    for (const f of block.match(/<filament\b[^>]*>/g) ?? []) {
      const id = Number(/\bid="(\d+)"/.exec(f)?.[1]);
      if (!id) continue;
      out.filaments.set(id, { color: hex(/\bcolor="([^"]+)"/.exec(f)?.[1]), type: /\btype="([^"]+)"/.exec(f)?.[1] });
    }
  }
  return out;
}

export interface ProjectLists {
  colors: string[];
  types: string[];
  nozzles: string[];
}

/** The project's filament colours, types and nozzles (project_settings.config is JSON), one per filament. */
export function parseProject(json: string | undefined): ProjectLists {
  const out: ProjectLists = { colors: [], types: [], nozzles: [] };
  if (!json) return out;
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
    out.colors = list(o.filament_colour);
    out.types = list(o.filament_type);
    // Dual-nozzle files say which nozzle each filament uses (1 left, 2 right) **[uncertain for the X2D]**.
    out.nozzles = list(o.filament_map);
  } catch {
    // Settings we can't read just mean no colours from here.
  }
  return out;
}

/** A colour as `#rrggbb`, from `#RRGGBB` or `#RRGGBBAA` with or without the hash; undefined when it isn't one. */
export function hex(v: string | undefined | null): string | undefined {
  const m = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec((v ?? "").trim());
  return m ? `#${m[1]?.toLowerCase()}` : undefined;
}
