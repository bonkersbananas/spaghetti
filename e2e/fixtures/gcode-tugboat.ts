/**
 * A little tugboat as Bambu Studio would slice it for the X2D: Bambu-style G-code with layer-change comments,
 * `; FEATURE:` types, M73 progress, an AMS filament change (M620/T/M621) with a flush into a prime tower, and a
 * .gcode.3mf around it. Navy hull and cabin, then a red funnel and trim. Invented, but realistic in structure
 * (docs/printer.md); the reader's unit tests, the e2e tests and the screenshot seed all use it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";

const here = import.meta.dirname;
const xml = '<?xml version="1.0" encoding="UTF-8"?>\n';

export interface TugboatOptions {
  /** mm. Default 0.12, which makes 317 layers. */
  layerHeight?: number;
}

/** Where the tugboat stands on the plate (mm) and its parts, shared with the tests. */
export const TUGBOAT = {
  centre: [128, 128] as const,
  hullHeight: 14,
  cabinTop: 26,
  height: 38,
  /** Layers at the default 0.12 mm. */
  layers: 317,
};

const FILAMENT_COLORS = ["#24476b", "#c8432f"];

export function tugboatGcode(options: TugboatOptions = {}): string {
  const lh = options.layerHeight ?? 0.12;
  const out: string[] = [];
  const total = Math.round(TUGBOAT.height / lh);
  const [cx, cy] = TUGBOAT.centre;
  let x = 0;
  let y = 0;
  let tool = 0;
  const f = (n: number) => (Math.round(n * 1000) / 1000).toString();

  const travel = (nx: number, ny: number) => {
    out.push(`G1 X${f(nx)} Y${f(ny)} F30000`);
    x = nx;
    y = ny;
  };
  const line = (nx: number, ny: number, width = 0.42, speed = 6000, lh2 = lh) => {
    const e = Math.hypot(nx - x, ny - y) * width * lh2 * 0.03;
    out.push(`G1 X${f(nx)} Y${f(ny)} E${f(e)} F${speed}`);
    x = nx;
    y = ny;
  };
  const feature = (name: string, width: number) => {
    out.push(`; FEATURE: ${name}`, `; LINE_WIDTH: ${width}`);
  };
  /** A closed outline of points, walked once. */
  const loop = (points: [number, number][], width = 0.42, speed = 6000) => {
    const first = points[0];
    if (!first) return;
    travel(first[0], first[1]);
    for (const p of points.slice(1)) line(p[0], p[1], width, speed);
    line(first[0], first[1], width, speed);
  };
  /** Stadium with a pointed bow: the hull's outline at inset `d`, in boat coordinates (bow to +x). */
  const hull = (d: number, taper = 0): [number, number][] => {
    const half = 13 - d - taper;
    const len = 35 - d - taper;
    const pts: [number, number][] = [];
    const bow = 10;
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      // Curved bow, from the shoulder to a point.
      pts.push([cx + len - bow + bow * Math.sin((t * Math.PI) / 2), cy - half * Math.cos((t * Math.PI) / 2)]);
    }
    for (let i = 11; i >= 0; i--) {
      const t = i / 12;
      pts.push([cx + len - bow + bow * Math.sin((t * Math.PI) / 2), cy + half * Math.cos((t * Math.PI) / 2)]);
    }
    pts.push(
      [cx - len + 4, cy + half],
      [cx - len, cy + half - 4],
      [cx - len, cy - half + 4],
      [cx - len + 4, cy - half],
    );
    return pts;
  };
  const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
  const infill = (x0: number, y0: number, x1: number, y1: number, pitch: number, flip: boolean) => {
    let down = true;
    for (let v = flip ? y0 : x0; v <= (flip ? y1 : x1); v += pitch) {
      const a = down ? (flip ? x0 : y0) : flip ? x1 : y1;
      const b = down ? (flip ? x1 : y1) : flip ? x0 : y0;
      if (flip) {
        travel(a, v);
        line(b, v);
      } else {
        travel(v, a);
        line(v, b);
      }
      down = !down;
    }
  };

  const estimate = 3 * 3600 + 20 * 60;
  out.push(
    "; HEADER_BLOCK_START",
    "; BambuStudio 02.01.00.00",
    `; total layer number: ${total}`,
    `; total estimated time: 3h 20m 0s`,
    "; HEADER_BLOCK_END",
    "",
    "; EXECUTABLE_BLOCK_START",
    "M73 P0 R200",
    "M201 X20000 Y20000 Z500 E5000",
    "G28",
    "; FEATURE: Custom",
    "G1 X10 Y10 F30000",
    "G1 X10 Y60 E6 F4000",
    "M83",
    "T0",
    "M620 S0A",
    "M621 S0A",
  );
  x = 10;
  y = 60;

  let percent = 0;
  for (let n = 0; n < total; n++) {
    const z = f((n + 1) * lh);
    const height = (n + 1) * lh;
    const remaining = Math.max(0, Math.round((estimate * (1 - n / total)) / 60));
    out.push(
      "; CHANGE_LAYER",
      `; Z_HEIGHT: ${z}`,
      `; LAYER_HEIGHT: ${lh}`,
      "G1 E-.8 F1800",
      `; layer num/total_layer_count: ${n + 1}/${total}`,
      "; update layer progress",
      `M73 L${n + 1}`,
      `M73 P${percent} R${remaining}`,
      `G1 Z${z} F1200`,
      "G1 E.8 F1800",
    );
    percent = Math.floor(((n + 1) / total) * 100);

    const inHull = height <= TUGBOAT.hullHeight;
    const inCabin = height > TUGBOAT.hullHeight - 0.01 && height <= TUGBOAT.cabinTop;
    const inFunnel = height > TUGBOAT.cabinTop;
    // The funnel and the cabin's roof trim print in red: one filament change at the cabin's roof.
    const wantTool = height > 22 ? 1 : 0;
    if (wantTool !== tool) {
      out.push(
        "; CHANGE_FILAMENT",
        `M620 S${wantTool}A`,
        `T${wantTool}`,
        `M621 S${wantTool}A`,
        "; WIPE_TOWER_START",
        "; FEATURE: Prime tower",
      );
      travel(230, 20);
      for (let k = 0; k < 6; k++) {
        line(236, 20 + k);
        line(230, 20 + k + 0.5);
      }
      out.push("; WIPE_TOWER_END");
      tool = wantTool;
    }

    if (n === 0) {
      feature("Skirt", 0.42);
      loop(hull(-3));
    }
    if (inHull) {
      const bottom = n < 5;
      const top = height > TUGBOAT.hullHeight - 0.6;
      feature("Outer wall", 0.42);
      loop(hull(0));
      feature("Inner wall", 0.45);
      loop(hull(0.45), 0.45, 9000);
      loop(hull(0.9), 0.45, 9000);
      feature(bottom ? "Bottom surface" : top ? "Top surface" : n % 2 ? "Sparse infill" : "Sparse infill", 0.45);
      if (bottom || top) infill(cx - 30, cy - 10, cx + 30, cy + 10, 0.6, n % 2 === 0);
      else infill(cx - 30, cy - 10, cx + 30, cy + 10, 6, n % 2 === 0);
    } else if (inCabin) {
      feature("Outer wall", 0.42);
      loop(rect(cx - 22, cy - 8, cx + 4, cy + 8));
      feature("Inner wall", 0.45);
      loop(rect(cx - 21.5, cy - 7.5, cx + 3.5, cy + 7.5), 0.45, 9000);
      feature("Sparse infill", 0.45);
      infill(cx - 20, cy - 6, cx + 2, cy + 6, 5, n % 2 === 0);
    } else if (inFunnel) {
      feature("Outer wall", 0.42);
      // The funnel is a circle drawn with arcs, as Bambu's arc fitting writes it.
      const r = 4.5;
      const fx = cx - 10;
      travel(fx + r, cy);
      const e = ((2 * Math.PI * r) / 2) * 0.42 * lh * 0.03;
      out.push(
        `G3 X${f(fx - r)} Y${f(cy)} I${f(-r)} J0 E${f(e)} F6000`,
        `G3 X${f(fx + r)} Y${f(cy)} I${f(r)} J0 E${f(e)} F6000`,
      );
      x = fx + r;
      y = cy;
    }
    if (n === 10) {
      feature("Bridge", 0.42);
      travel(cx - 5, cy - 3);
      line(cx + 5, cy - 3);
    }
  }
  out.push("; EXECUTABLE_BLOCK_END", "", "; filament end gcode", "M106 S0", "G1 X0 Y250 E3 F3000", "M104 S0", "M84");
  return `${out.join("\n")}\n`;
}

const sliceInfo = `${xml}<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
    <header_item key="X-BBL-Client-Version" value="02.01.00.00"/>
  </header>
  <plate>
    <metadata key="index" value="1"/>
    <metadata key="nozzle_diameters" value="0.4"/>
    <metadata key="prediction" value="12000"/>
    <metadata key="weight" value="27.6"/>
    <metadata key="support_used" value="false"/>
    <object identify_id="101" name="Tugboat" skipped="false" />
    <filament id="1" tray_info_idx="GFA00" type="PLA" color="${FILAMENT_COLORS[0]}FF" used_m="7.9" used_g="22.10" />
    <filament id="2" tray_info_idx="GFA00" type="PLA" color="${FILAMENT_COLORS[1]}FF" used_m="1.9" used_g="5.50" />
  </plate>
</config>`;

const modelSettings = `${xml}<config>
  <object id="2"><metadata key="name" value="Tugboat"/><metadata key="extruder" value="1"/></object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value="Tugboat"/>
    <metadata key="bed_type" value="Textured PEI Plate"/>
    <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>
    <model_instance><metadata key="object_id" value="2"/><metadata key="identify_id" value="101"/></model_instance>
  </plate>
</config>`;

const projectSettings = JSON.stringify({
  printer_model: "Bambu Lab X2D",
  printer_settings_id: "Bambu Lab X2D 0.4 nozzle",
  print_settings_id: "0.12mm Fine @BBL X2D",
  layer_height: "0.12",
  initial_layer_print_height: "0.12",
  sparse_infill_density: "15%",
  sparse_infill_pattern: "grid",
  wall_loops: "3",
  enable_support: "0",
  nozzle_diameter: ["0.4"],
  curr_bed_type: "Textured PEI Plate",
  nozzle_temperature: ["220", "220"],
  nozzle_temperature_initial_layer: ["220", "220"],
  textured_plate_temp: ["55", "55"],
  filament_type: ["PLA", "PLA"],
  filament_colour: FILAMENT_COLORS,
  filament_settings_id: ["Bambu PLA Basic @BBL X2D", "Bambu PLA Basic @BBL X2D"],
});

export const TUGBOAT_FILE_NAME = "tugboat.gcode.3mf";

/** A one-plate `.gcode.3mf` holding `tugboatGcode()`. `colors: false` leaves the project settings' filament colours out, so only the slice's remain. */
export function tugboatFile(options: TugboatOptions & { colors?: boolean } = {}): Uint8Array {
  const settings =
    options.colors === false ? projectSettings.replace(/"filament_colour":\[[^\]]*\],?/, "") : projectSettings;
  return zipSync({
    "[Content_Types].xml": strToU8(`${xml}<Types/>`),
    "3D/3dmodel.model": strToU8(
      `${xml}<model unit="millimeter"><metadata name="Application">BambuStudio-02.01.00.00</metadata><resources/><build/></model>`,
    ),
    "Metadata/model_settings.config": strToU8(modelSettings),
    "Metadata/slice_info.config": strToU8(sliceInfo),
    "Metadata/project_settings.config": strToU8(settings),
    "Metadata/plate_1.png": new Uint8Array(readFileSync(join(here, "plate-tugboat.png"))),
    "Metadata/plate_1.gcode": strToU8(tugboatGcode(options)),
  });
}
