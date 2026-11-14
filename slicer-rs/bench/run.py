"""The slicer benchmark: every runner on every model, a few runs each, wall time, peak memory and output size,
and the quality facts (layers, filament, estimated time, per feature) next to native Orca's.

    python3 -I run.py [--runs N] [--only runner,…] [--models name,…]

Models are placed STLs (see place.py) in $BENCH_MODELS (default /home/agent/build/bench-in): benchy.stl,
glasses.stl, uobf.stl and plate/benchy-1…12.stl, and a plate in two filaments (colour.py): colour/block.stl and
colour/letter.stl, each on a nozzle of its own as Orca groups them ("colour") or both on the left one, flushing
between them ("colour-one-nozzle"). Runners whose tools are missing are skipped:
- rust-native, rust-native-1t: ../target/release/spaghetti-slicer (cargo build --release)
- rust-wasm-node, rust-wasm-chromium: ../target/wasm32-unknown-unknown/release/spaghetti_slicer.wasm
- orca-wasm-node, orca-wasm-chromium: the OrcaSlicer engine Spaghetti runs today, from $ORCA_SPIKE (a folder with
  slice-node.mjs, run-browsers.mjs, serve.mjs, engine-0.6.1/ and presets-pin.json)
- orca-native: OrcaSlicer 2.5.0's command line from $ORCA_NATIVE (an extracted AppImage), with the same presets
  ($ORCA_PRESETS, default $ORCA_SPIKE: machine.json, process.json, filament.json; the machine's curr_bed_type picks
  the plate) and the models left where the files put them (--arrange 0), as ours are (--keep-placement)
Native runs are pinned to 4 cores (taskset), the sandbox's share. Results go to out/results.json."""

import json
import os
import shutil
import statistics
import struct
import subprocess
import sys
import time
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
CRATE = os.path.dirname(HERE)
OUT = os.path.join(HERE, "out")
MODELS_DIR = os.environ.get("BENCH_MODELS", "/home/agent/build/bench-in")
SPIKE = os.environ.get("ORCA_SPIKE", "/home/agent/build/spike")
PRESETS = os.environ.get("ORCA_PRESETS", SPIKE)
NATIVE = os.environ.get("ORCA_NATIVE", "/home/agent/build/orca-native")
BIN = os.path.join(CRATE, "target/release/spaghetti-slicer")
WASM = os.path.join(CRATE, "target/wasm32-unknown-unknown/release/spaghetti_slicer.wasm")
MEASURE = [sys.executable, "-I", os.path.join(HERE, "measure.py")]
CORES = ["taskset", "-c", "0-3"]

MODELS = {
    "benchy": ["benchy.stl"],
    "glasses": ["glasses.stl"],
    "uobf": ["uobf.stl"],
    "plate": [f"plate/benchy-{k}.stl" for k in range(1, 13)],
    "colour": ["colour/block.stl", "colour/letter.stl"],
    "colour-one-nozzle": ["colour/block.stl", "colour/letter.stl"],
}
# Plates in several filaments: each file's filament (1-based), in the app's stand-in colours; and where a plate's
# filaments go on nozzles of Orca's manual grouping (1 the left), the map.
FILAMENTS = {"colour": [1, 2], "colour-one-nozzle": [1, 2]}
COLOURS = ["#F2754E", "#4F7FC7"]
FILAMENT_MAP = {"colour-one-nozzle": [1, 1]}
BED = 256.0


def stl_box(path):
    """A binary STL's extent on the plate: min x, min y, max x, max y."""
    with open(path, "rb") as f:
        data = f.read()
    n = struct.unpack_from("<I", data, 80)[0]
    xs, ys = [], []
    for k in range(n):
        v = struct.unpack_from("<9f", data, 84 + 50 * k + 12)
        xs += v[0::3]
        ys += v[1::3]
    return [min(xs), min(ys), max(xs), max(ys)]


def tower_spot(files, width):
    """Where the app puts the prime tower (its towerSpot): the first corner of the plate no object comes near."""
    depth, margin = 50.0, 10.0
    boxes = [stl_box(f) for f in files]
    corners = [(BED - width - margin, BED - depth - margin), (margin, BED - depth - margin), (BED - width - margin, margin), (margin, margin)]
    clear = lambda c: all(b[2] + 5 < c[0] or b[0] - 5 > c[0] + width or b[3] + 5 < c[1] or b[1] - 5 > c[1] + depth for b in boxes)
    x, y = next((c for c in corners if clear(c)), corners[0])
    return round(x), round(y)


def rust_setup(model, d):
    """The slice setup for a plate in several filaments (the app's sliceSetup gives one), and the arguments for it."""
    if model not in FILAMENTS:
        return []
    setup = {"filaments": [{} for _ in COLOURS], "colours": COLOURS}
    if model in FILAMENT_MAP:
        setup["process"] = {"filament_map_mode": "Manual", "filament_map": [str(n) for n in FILAMENT_MAP[model]]}
    json.dump(setup, open(f"{d}/setup.json", "w"))
    return ["--setup", f"{d}/setup.json", "--filaments", ",".join(map(str, FILAMENTS[model]))]


def colours_facts(gcode):
    """A plate in several filaments, from its G-code: its tool changes, and the prime tower's extent on the first layer
    (width and depth, mm, of where its extrusions end: Orca's arcs bulge a little beyond)."""
    changes, layer, feature, box = 0, 0, "", [float("inf"), float("inf"), float("-inf"), float("-inf")]
    x = y = 0.0
    for line in open(gcode):
        if line.startswith("; CHANGE_LAYER"):
            layer += 1
        elif line.startswith("; CP TOOLCHANGE START"):
            changes += 1
        elif line.startswith("; FEATURE: "):
            feature = line[11:].strip()
        elif line[:3] in ("G1 ", "G2 ", "G3 "):
            words = dict((w[0], w[1:]) for w in line.split(";")[0].split()[1:] if w[0] in "XYE")
            x, y = float(words.get("X", x)), float(words.get("Y", y))
            if layer == 1 and feature == "Prime tower" and float(words.get("E", 0)) > 0 and ("X" in words or "Y" in words):
                box = [min(box[0], x), min(box[1], y), max(box[2], x), max(box[3], y)]
    return {"tool_changes": changes, "tower_mm": [round(box[2] - box[0], 2), round(box[3] - box[1], 2)] if box[0] < box[2] else None}


def measure(cmd, env=None, cwd=None):
    full = dict(os.environ)
    full.update(env or {})
    done = subprocess.run(MEASURE + cmd, stdout=subprocess.PIPE, env=full, cwd=cwd, check=False)
    return json.loads(done.stdout)


def deflated(path):
    """The G-code's size deflated at level 6, as the app packs the engine's G-code into its .gcode.3mf."""
    with open(path, "rb") as f:
        data = f.read()
    c = zlib.compressobj(6, zlib.DEFLATED, -15)
    return len(c.compress(data) + c.flush())


def rust_native(model, files, run, threads):
    d = os.path.join(OUT, f"rust-native-{threads}t-{model}")
    os.makedirs(d, exist_ok=True)
    m = measure(
        CORES
        + [BIN, "--keep-placement", "--timings", "-o", f"{d}/out.gcode.3mf", "--gcode", f"{d}/out.gcode", "--stats", f"{d}/stats.json"]
        + rust_setup(model, d)
        + files,
        env={"RAYON_NUM_THREADS": str(threads)},
    )
    stats = json.load(open(f"{d}/stats.json"))["summary"]
    if model in FILAMENTS:
        stats.update(colours_facts(f"{d}/out.gcode"))
    return {
        "wall_ms": m["wall_ms"],
        "peak_mb": m["peak_mb"],
        "cpu_s": m["cpu_s"],
        "steps": m["stderr"].strip().splitlines()[-1] if m["stderr"].strip() else "",
        "file_bytes": os.path.getsize(f"{d}/out.gcode.3mf"),
        "gcode_bytes": os.path.getsize(f"{d}/out.gcode"),
        "stats": stats,
        "gcode": f"{d}/out.gcode",
    }


def rust_wasm_node(model, files, run):
    d = os.path.join(OUT, f"rust-wasm-node-{model}")
    os.makedirs(d, exist_ok=True)
    m = measure(["node", os.path.join(HERE, "wasm-node.mjs"), WASM, f"{d}/out.gcode.3mf", "--keep-placement"] + rust_setup(model, d) + files)
    r = json.loads(m["stdout"].strip().splitlines()[-1])
    return {
        "wall_ms": m["wall_ms"],
        "slice_ms": r["sliceMs"],
        "peak_mb": m["peak_mb"],
        "wasm_memory_mb": r["wasmMemoryMB"],
        "file_bytes": r["fileBytes"],
        "gcode_bytes": r["gcodeBytes"],
        "stats": r["stats"],
    }


def rust_wasm_browser(model, files, runs, browser):
    out = subprocess.run(
        ["node", os.path.join(HERE, "wasm-browser.mjs"), browser, os.path.dirname(WASM), str(runs), "--keep-placement"] + files,
        stdout=subprocess.PIPE,
        check=True,
    )
    results = []
    for line in out.stdout.decode().strip().splitlines():
        r = json.loads(line)
        results.append(
            {
                "wall_ms": r["sliceMs"],
                "peak_mb": r["memory"]["peakExtraMB"],
                "wasm_memory_mb": r["wasmMemoryMB"],
                "file_bytes": r["fileBytes"],
                "stats": r["stats"],
            }
        )
    return results


def orca_wasm_node(model, files, run):
    d = os.path.join(OUT, f"orca-wasm-node-{model}")
    os.makedirs(d, exist_ok=True)
    m = measure(["node", "slice-node.mjs", "engine-0.6.1", "presets-pin.json", f"{d}/out.gcode"] + files, cwd=SPIKE)
    r = json.loads(m["stdout"].strip().splitlines()[-1])
    if "error" in r:
        return {"error": r["error"], "wall_ms": m["wall_ms"], "peak_mb": m["peak_mb"]}
    return {
        "wall_ms": m["wall_ms"],
        "slice_ms": r["ms"],
        "peak_mb": m["peak_mb"],
        "gcode_bytes": os.path.getsize(f"{d}/out.gcode"),
        "file_bytes_estimate": deflated(f"{d}/out.gcode"),
        "stats": r["stats"],
        "gcode": f"{d}/out.gcode",
    }


def orca_wasm_browser(model, files, runs, browser):
    # The spike's page reads models from /inputs/<path under /home/agent/build/inputs>.
    link = "/home/agent/build/inputs/bench"
    if not os.path.exists(link):
        os.symlink(MODELS_DIR, link)
    rel = [os.path.relpath(f, MODELS_DIR) for f in files]
    server = subprocess.Popen(["node", "serve.mjs", "8787", "engine-0.6.1", "presets-pin.json"], cwd=SPIKE, stdout=subprocess.DEVNULL)
    time.sleep(1.0)
    try:
        out = subprocess.run(
            ["node", "run-browsers.mjs", browser] + [f"bench/{r}" for r in rel],
            cwd=SPIKE,
            stdout=subprocess.PIPE,
            env=dict(os.environ, RUNS=str(runs)),
            check=False,
        )
    finally:
        server.terminate()
        server.wait()
    results = []
    for line in out.stdout.decode().strip().splitlines():
        if not line.startswith("{"):
            continue
        r = json.loads(line)
        if not r.get("done"):
            results.append({"error": r.get("error", "failed")})
            continue
        ms = r.get("ms") or {}
        results.append(
            {
                # From reading the files to the packed file, with the engine already loaded (as the app keeps it).
                "wall_ms": ms.get("total", 0) - ms.get("engineLoad", 0),
                "slice_ms": ms.get("slice"),
                "steps": ms,
                "peak_mb": r["memory"]["peakExtraMB"],
                "stats": r.get("stats"),
            }
        )
    return results


def orca_native(model, files, run):
    d = os.path.join(OUT, f"orca-native-{model}")
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d, exist_ok=True)
    os.makedirs("/tmp/xdg", exist_ok=True)
    root = os.path.join(NATIVE, "squashfs-root")
    env = {
        "XDG_RUNTIME_DIR": "/tmp/xdg",
        "LD_LIBRARY_PATH": f"{NATIVE}/stubs:{root}/lib:{root}/usr/lib",
    }
    process, filaments, extra = f"{PRESETS}/process.json", f"{PRESETS}/filament.json", []
    if model in FILAMENTS:
        # Each filament the presets' in its colour, each file in its filament, and the tower where the app puts it.
        work = os.path.join(OUT, f"orca-native-{model}-presets")
        os.makedirs(work, exist_ok=True)
        names = []
        for k, colour in enumerate(COLOURS):
            f = json.load(open(f"{PRESETS}/filament.json"))
            f["filament_colour"] = [colour]
            names.append(f"{work}/filament-{k + 1}.json")
            json.dump(f, open(names[-1], "w"))
        p = json.load(open(process))
        width = float(str(p.get("prime_tower_width", "35")).strip("[]'\""))
        x, y = tower_spot(files, width)
        p["wipe_tower_x"], p["wipe_tower_y"] = [str(x)], [str(y)]
        process = f"{work}/process.json"
        json.dump(p, open(process, "w"))
        filaments = ";".join(names)
        extra = ["--load-filament-ids", ",".join(map(str, FILAMENTS[model]))]
        if model in FILAMENT_MAP:
            extra += ["--filament-map-mode", "Manual", "--filament-map", ",".join(map(str, FILAMENT_MAP[model]))]
    m = measure(
        CORES
        + [
            f"{root}/bin/orca-slicer",
            "--arrange",
            "0",
            "--load-settings",
            f"{PRESETS}/machine.json;{process}",
            "--load-filaments",
            filaments,
            "--slice",
            "0",
            "--outputdir",
            d,
            "--export-statistics",
        ]
        + extra
        + files,
        env=env,
    )
    gcode = f"{d}/plate_1.gcode"
    if not os.path.exists(gcode):
        return {"error": m["stderr"][-300:], "wall_ms": m["wall_ms"], "peak_mb": m["peak_mb"]}
    stats = json.load(open(f"{d}/plate_1.statistics.json"))
    summary = {k: v for k, v in stats["summary"].items() if k != "filaments" or model in FILAMENTS}
    if model in FILAMENTS:
        summary.update(colours_facts(gcode))
    return {
        "wall_ms": m["wall_ms"],
        "peak_mb": m["peak_mb"],
        "cpu_s": m["cpu_s"],
        "gcode_bytes": os.path.getsize(gcode),
        "file_bytes_estimate": deflated(gcode),
        "stats": summary,
        "gcode": gcode,
    }


def main():
    args = sys.argv[1:]
    runs = int(args[args.index("--runs") + 1]) if "--runs" in args else 3
    only = args[args.index("--only") + 1].split(",") if "--only" in args else None
    models = args[args.index("--models") + 1].split(",") if "--models" in args else list(MODELS)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "results.json")
    results = json.load(open(path)) if os.path.exists(path) else {}
    runners = {
        "rust-native": lambda m, f, r: rust_native(m, f, r, 4),
        "rust-native-1t": lambda m, f, r: rust_native(m, f, r, 1),
        "rust-wasm-node": rust_wasm_node,
        "orca-wasm-node": orca_wasm_node,
        "orca-native": orca_native,
    }
    browsers = {
        "rust-wasm-chromium": lambda m, f, n: rust_wasm_browser(m, f, n, "chromium"),
        "orca-wasm-chromium": lambda m, f, n: orca_wasm_browser(m, f, n, "chromium"),
    }
    for model in models:
        files = [os.path.join(MODELS_DIR, f) for f in MODELS[model]]
        for name, fn in list(runners.items()) + list(browsers.items()):
            if only and name not in only:
                continue
            print(f"{model} / {name} …", file=sys.stderr, flush=True)
            if name in browsers:
                got = fn(model, files, runs)
            else:
                got = [fn(model, files, r) for r in range(runs)]
            ok = [g for g in got if "error" not in g]
            entry = {"runs": got}
            if ok:
                entry["wall_ms"] = statistics.median(g["wall_ms"] for g in ok)
                entry["peak_mb"] = max(g["peak_mb"] for g in ok)
            results.setdefault(model, {})[name] = entry
            print(f"  {entry.get('wall_ms')} ms, {entry.get('peak_mb')} MB", file=sys.stderr, flush=True)
            json.dump(results, open(path, "w"), indent=1)
    print(path)


main()
