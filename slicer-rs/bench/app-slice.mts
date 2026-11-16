// Slices a model as the app does, in Node: runs the app's own slice worker (src/client/lib/slicing/slice-worker.ts)
// with a model's saved slicing settings over the workshop's defaults, so it reads, turns, scales, arranges and gives
// fins to the model, makes the setup (sliceSetup) and hands Spaghetti's slicer what it hands it in the browser. That
// is then sliced with the WebAssembly module through the app's own ours.ts, and written out so the other slicers can
// slice the very same thing:
//
//   setup.json, job.json, objects/   the setup and each object (or part) as an STL with its filament and paint, in
//                                    the order the app adds them; `spaghetti-slicer --job job.json` and
//                                    `node bench/wasm-node.mjs <wasm> <out> --job job.json` replay them
//   orca/                            the same for native OrcaSlicer: the setup's machine, process and filament
//                                    presets as JSON and plate.3mf, the objects where the app put them (a part
//                                    each, painted with paint_color and paint_supports), for --arrange 0
//   app.json, app.gcode.3mf          what the app's worker made of it: the slice's record (or failure and the words
//                                    of a refusal), its notes and warnings, and the time the module took
//
//   node slicer-rs/bench/app-slice.mts --model <file> --out <dir> --engine <engine release dir>
//     --wasm <spaghetti_slicer.wasm> [--slicing '<settings JSON>'] [--printer '<printer setup JSON>']
//
// The settings are a model's row's `slicing` (item_files.slicing), the printer the printer table's `setup`; the
// engine's release folder holds presets.json (scripts/slicer/engine.json names the zip). Models stay out of the
// repository: bench/models.md says where they come from.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { strToU8, zipSync } from "fflate";

const { resolve: resolveHook } = await import("./app/hooks.mjs");
registerHooks({ resolve: resolveHook });

const { values } = parseArgs({
  options: {
    model: { type: "string" },
    out: { type: "string" },
    engine: { type: "string" },
    wasm: { type: "string" },
    slicing: { type: "string", default: "{}" },
    printer: { type: "string" },
    name: { type: "string" },
  },
});
if (!values.model || !values.out || !values.engine || !values.wasm) {
  process.stderr.write(
    "Usage: node slicer-rs/bench/app-slice.mts --model <file> --out <dir> --engine <dir> --wasm <file> [--slicing JSON] [--printer JSON]\n",
  );
  process.exit(2);
}
const out = resolve(values.out);
mkdirSync(join(out, "objects"), { recursive: true });
mkdirSync(join(out, "orca"), { recursive: true });

// The worker's surroundings: `self`, files by URL, and an OrcaSlicer engine that isn't there (ours is what's measured).
const posted: { type: string; [key: string]: unknown }[] = [];
let settle: () => void = () => {};
const finished = new Promise<void>((done) => {
  settle = done;
});
const scope = globalThis as unknown as Record<string, unknown>;
scope.self = globalThis;
scope.postMessage = (message: { type: string }) => {
  posted.push(message);
  if (message.type === "done" || message.type === "failed") settle();
};
scope.close = () => {};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "file:") return realFetch(input, init);
  const bytes = readFileSync(url);
  const type = url.pathname.endsWith(".wasm") ? "application/wasm" : "application/json";
  return new Response(bytes, { headers: { "content-type": type } });
}) as typeof fetch;
scope.Worker = class {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string; preventDefault(): void }) => void) | null = null;
  postMessage(message: { id: number }) {
    queueMicrotask(() =>
      this.onmessage?.({
        data: {
          v: 2,
          id: message.id,
          kind: "error",
          error: { code: 99, message: "OrcaSlicer's engine isn't run here" },
        },
      }),
    );
  }
  terminate() {}
};

const { recorded } = await import("./app/app-ours.mts");
const { workshopDefaults } = await import("../../src/shared/slicing/pantry.ts");
const { DEFAULT_PRINTER } = await import("../../src/shared/spools.ts");
const { writeStl } = await import("../../src/shared/mesh.ts");
const { paintBytes } = await import("../../src/shared/slicing/paint.ts");
await import("../../src/client/lib/slicing/slice-worker.ts");

const printer = values.printer ? JSON.parse(values.printer) : DEFAULT_PRINTER;
const defaults = workshopDefaults({ spools: [], setup: printer });
const chosen = JSON.parse(values.slicing);
const name = values.name ?? basename(values.model);
const engineDir = pathToFileURL(`${resolve(values.engine)}/`).href;
const wasm = resolve(values.wasm);
(scope.onmessage as (event: { data: unknown }) => void)({
  data: {
    file: new Blob([readFileSync(values.model)]),
    name,
    chosen,
    defaults,
    spools: [],
    engine: { base: engineDir, host: "host.js", version: "bench" },
    rust: { base: pathToFileURL(`${join(wasm, "..")}/`).href, wasm: basename(wasm), version: "bench" },
  },
});
await finished;

const last = posted.at(-1) as { type: string; slice?: Record<string, unknown> };
const rec = recorded.value;
const answer = rec?.answer;
const report: Record<string, unknown> = {
  model: name,
  status: last.type,
  slice: last.slice,
  ours: answer
    ? answer.ok
      ? { ok: true, ms: Math.round(answer.ms), notes: answer.notes, warnings: answer.warnings }
      : { ok: false, fallback: answer.fallback }
    : null,
};
if (answer?.ok) writeFileSync(join(out, "app.gcode.3mf"), answer.sliced);
writeFileSync(join(out, "app.json"), `${JSON.stringify(report, null, 2)}\n`);
if (!rec) {
  process.stderr.write(`${name}: the worker didn't hand our slicer anything (${JSON.stringify(last.slice)})\n`);
  process.exit(1);
}

// The setup, and each object or part as the app added it.
writeFileSync(join(out, "setup.json"), rec.setup);
const setup = JSON.parse(rec.setup) as {
  machine: Record<string, unknown>;
  process: Record<string, unknown>;
  filaments: Record<string, unknown>[];
};
const several = setup.filaments.length > 1;
interface Call {
  op: "add" | "add_in" | "add_part";
  name: string;
  stl: string;
  filament?: number;
  first?: boolean;
  paint?: string;
  supports?: string;
}
const calls: Call[] = [];
// For OrcaSlicer: each object's parts, each a mesh with its filament and the paint on it.
interface OrcaPart {
  positions: Float32Array;
  filament: number;
  paint?: { triangles: Uint32Array; codes: string; ends: Uint32Array };
  supports?: { triangles: Uint32Array; codes: string; ends: Uint32Array };
}
const orcaObjects: { name: string; filament: number; parts: OrcaPart[] }[] = [];
for (const [k, object] of rec.objects.entries()) {
  const parts = object.parts ?? [
    {
      positions: object.positions,
      filament: object.filament ?? 1,
      ...(object.paint ? { paint: object.paint } : {}),
      ...(object.supports ? { supports: object.supports } : {}),
    },
  ];
  orcaObjects.push({ name: object.name, filament: object.filament ?? 1, parts });
  for (const [p, part] of parts.entries()) {
    const stem = `objects/${k + 1}${object.parts ? `-${p + 1}` : ""}`;
    writeFileSync(join(out, `${stem}.stl`), writeStl({ positions: part.positions }, object.name));
    const call: Call = object.parts
      ? { op: "add_part", name: object.name, stl: `${stem}.stl`, filament: part.filament, first: p === 0 }
      : several && object.filament
        ? { op: "add_in", name: object.name, stl: `${stem}.stl`, filament: object.filament }
        : { op: "add", name: object.name, stl: `${stem}.stl` };
    if (part.paint) {
      writeFileSync(join(out, `${stem}.paint`), paintBytes(part.paint));
      call.paint = `${stem}.paint`;
    }
    if (part.supports) {
      writeFileSync(join(out, `${stem}.supports`), paintBytes(part.supports));
      call.supports = `${stem}.supports`;
    }
    calls.push(call);
  }
}
writeFileSync(join(out, "job.json"), `${JSON.stringify({ setup: "setup.json", calls }, null, 1)}\n`);

// OrcaSlicer's presets, and the plate as a project it reads: the objects where the app put them.
writeFileSync(join(out, "orca/machine.json"), JSON.stringify(setup.machine));
writeFileSync(join(out, "orca/process.json"), JSON.stringify(setup.process));
for (const [k, filament] of setup.filaments.entries()) {
  writeFileSync(join(out, `orca/filament-${k + 1}.json`), JSON.stringify(filament));
}
writeFileSync(join(out, "orca/plate.3mf"), project(orcaObjects));
process.stdout.write(
  `${name}: ${last.type}${answer ? (answer.ok ? `, ours in ${Math.round(answer.ms)} ms` : `, ours refused: ${JSON.stringify(answer.fallback)}`) : ""}\n`,
);

/** A 3MF of the objects as Bambu Studio writes a project: a mesh per part, an object of components, the extruders. */
function project(objects: typeof orcaObjects): Uint8Array {
  let id = 0;
  const resources: string[] = [];
  const items: string[] = [];
  const settings: string[] = [];
  const objectIds: number[] = [];
  for (const object of objects) {
    const partIds: number[] = [];
    for (const part of object.parts) {
      id++;
      partIds.push(id);
      resources.push(`<object id="${id}" type="model">${meshXml(part)}</object>`);
    }
    id++;
    resources.push(
      `<object id="${id}" type="model"><components>${partIds.map((p) => `<component objectid="${p}"/>`).join("")}</components></object>`,
    );
    items.push(`<item objectid="${id}"/>`);
    objectIds.push(id);
    const partSettings = object.parts
      .map(
        (part, k) =>
          `<part id="${partIds[k]}" subtype="normal_part"><metadata key="name" value="${xml(object.name)} ${k + 1}"/><metadata key="extruder" value="${part.filament}"/></part>`,
      )
      .join("");
    settings.push(
      `<object id="${id}"><metadata key="name" value="${xml(object.name)}"/><metadata key="extruder" value="${object.filament}"/>${partSettings}</object>`,
    );
  }
  const model =
    '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
    `<resources>${resources.join("")}</resources><build>${items.join("")}</build></model>`;
  const instances = objectIds
    .map((object) => `<model_instance><metadata key="object_id" value="${object}"/></model_instance>`)
    .join("");
  const config =
    '<?xml version="1.0" encoding="UTF-8"?>\n<config>' +
    settings.join("") +
    `<plate><metadata key="plater_id" value="1"/>${instances}</plate></config>`;
  const types =
    '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
  return zipSync(
    {
      "[Content_Types].xml": strToU8(types),
      "_rels/.rels": strToU8(rels),
      "3D/3dmodel.model": strToU8(model),
      "Metadata/model_settings.config": strToU8(config),
    },
    { level: 1 },
  );
}

/** A part's mesh as 3MF XML, corners shared where they are equal (as an STL reader joins them), paint on its triangles. */
function meshXml(part: OrcaPart): string {
  const index = new Map<string, number>();
  const vertices: string[] = [];
  const triangles: string[] = [];
  const codeOf = (paint: OrcaPart["paint"]) => {
    const codes = new Map<number, string>();
    if (!paint) return codes;
    let from = 0;
    for (let k = 0; k < paint.triangles.length; k++) {
      const to = paint.ends[k] as number;
      codes.set(paint.triangles[k] as number, paint.codes.slice(from, to));
      from = to;
    }
    return codes;
  };
  const colours = codeOf(part.paint);
  const supports = codeOf(part.supports);
  const p = part.positions;
  for (let t = 0; t < p.length / 9; t++) {
    const ids: number[] = [];
    for (let c = 0; c < 3; c++) {
      const b = t * 9 + c * 3;
      const key = `${p[b]} ${p[b + 1]} ${p[b + 2]}`;
      let at = index.get(key);
      if (at === undefined) {
        at = vertices.length;
        index.set(key, at);
        // Float32 values written in full, so Orca reads back the same floats.
        vertices.push(`<vertex x="${p[b]}" y="${p[b + 1]}" z="${p[b + 2]}"/>`);
      }
      ids.push(at);
    }
    const colour = colours.get(t);
    const support = supports.get(t);
    triangles.push(
      `<triangle v1="${ids[0]}" v2="${ids[1]}" v3="${ids[2]}"${colour ? ` paint_color="${colour}"` : ""}${support ? ` paint_supports="${support}"` : ""}/>`,
    );
  }
  return `<mesh><vertices>${vertices.join("")}</vertices><triangles>${triangles.join("")}</triangles></mesh>`;
}

function xml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
