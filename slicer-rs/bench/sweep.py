"""The real-models sweep: slices each model people sliced in the app as the app slices it, with Spaghetti's slicer
natively and in WebAssembly and with native OrcaSlicer 2.5.1, the same objects in the same places with the same
settings, and compares them (docs/proposals/rust-slicer.md, section 3, "Real models").

  python3 -I bench/sweep.py --corpus DIR [--out DIR] [--only NAME,...] [--runs N] [--skip-orca] [--table]

The corpus is a folder of the models, named as in real-models.json (which keeps each one's size, sha256 and the
settings it was sliced with in the app); the models are people's downloads under their designers' licences and stay
out of the repository. For each model it runs bench/app-slice.mts (the app's own slice worker, with the module), then
`spaghetti-slicer --job` (native, 4 threads), `wasm-node.mjs --job` (WebAssembly in Node) and OrcaSlicer's command
line on the plate the app laid out. Times are medians of --runs runs (the first run's files are compared); memory is
the peak resident set natively and the WebAssembly memory at the end. Results go to <out>/results.json, and --table
prints the proposal's tables from them.

Needs: cargo build --release, the wasm32 build (see README), the engine's release folder (ENGINE, presets.json) and
an extracted OrcaSlicer 2.5.1 AppImage (ORCA_NATIVE, its squashfs-root's parent).
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import statistics
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CRATE = os.path.dirname(HERE)
ROOT = os.path.dirname(CRATE)
NATIVE_BIN = os.path.join(CRATE, "target/release/spaghetti-slicer")
WASM = os.path.join(CRATE, "target/wasm32-unknown-unknown/release/spaghetti_slicer.wasm")
ENGINE = os.environ.get("ENGINE", "/home/agent/engine/e")
ORCA = os.environ.get("ORCA_NATIVE", "/home/agent/orca")
MEASURE = [sys.executable, "-I", os.path.join(HERE, "measure.py")]
CORES = ["taskset", "-c", "0-3"] if shutil.which("taskset") else []


def slug(name):
    return re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").lower()


def measure(cmd, env=None, cwd=None):
    full = dict(os.environ)
    full.update(env or {})
    done = subprocess.run(MEASURE + cmd, stdout=subprocess.PIPE, env=full, cwd=cwd, check=False)
    return json.loads(done.stdout)


def gcode_facts(path):
    """From the plate's G-code: retractions (each ends with a plain `G1 E<positive>`), tool changes, and plastic by
    feature in mm³ counted only on moves that change X or Y (un-retractions after travel would inflate it)."""
    retractions = changes = 0
    feature = ""
    by = {}
    area = None
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("G1 E") and not line.startswith("G1 E-"):
                retractions += 1
            elif line.startswith("; CP TOOLCHANGE START"):
                changes += 1
            elif line.startswith("; FEATURE: "):
                feature = line[11:].strip()
            elif line.startswith("; filament_diameter = ") and area is None:
                d = float(line.split("=")[1].split(",")[0])
                area = 3.141592653589793 * d * d / 4
            elif line[:3] in ("G1 ", "G2 ", "G3 "):
                code = line.split(";")[0]
                if "E" in code and ("X" in code or "Y" in code):
                    for w in code.split()[1:]:
                        if w[0] == "E":
                            e = float(w[1:])
                            if e > 0:
                                by[feature] = by.get(feature, 0.0) + e
    area = area or 2.405281875
    return {"retractions": retractions, "tool_changes": changes, "features_mm3": {k: v * area for k, v in by.items()}}


def split_time(stats, orca):
    """The estimate and its parts, the same way for both: the start, the time spent extruding (every feature's) and
    the rest after the start (travel, retractions, wipes, lifts, tool changes)."""
    extruding = sum(f["time"] for f in stats["features"].values())
    total = stats["time"]
    return {"time": total, "start": stats["prepare_time"], "extruding": extruding, "moving": total - stats["prepare_time"] - extruding}


def run_app(entry, path, d, printer):
    cmd = [
        "node",
        os.path.join(HERE, "app-slice.mts"),
        "--model",
        path,
        "--name",
        entry["name"],
        "--out",
        d,
        "--engine",
        ENGINE,
        "--wasm",
        WASM,
        "--slicing",
        json.dumps(entry.get("slicing") or {}),
        "--printer",
        json.dumps(printer),
    ]
    m = measure(cmd)
    app = json.load(open(os.path.join(d, "app.json"))) if os.path.exists(os.path.join(d, "app.json")) else None
    return {"code": m["code"], "stderr": m["stderr"][-800:], "app": app}


def run_native(d, runs):
    out = []
    for k in range(runs):
        m = measure(
            CORES
            + [NATIVE_BIN, "--job", "job.json", "-o", "native.gcode.3mf", "--gcode", "native.gcode", "--stats", "native.stats.json"],
            cwd=d,
        )
        out.append(m)
        if m["code"] != 0:
            break
    return out


def run_wasm(d, runs):
    out = []
    for k in range(runs):
        done = subprocess.run(
            ["node", os.path.join(HERE, "wasm-node.mjs"), WASM, "wasm.gcode.3mf", "--job", "job.json"],
            cwd=d,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        try:
            r = json.loads(done.stdout.decode().strip().splitlines()[-1])
        except (ValueError, IndexError):
            r = {"code": done.returncode, "stderr": done.stderr.decode()[-800:]}
        out.append(r)
        if done.returncode != 0:
            break
    return out


# Values a Bambu Studio project may carry that Orca 2.5.1's command line refuses outright ("Param values in 3mf/config
# error", return -18) without saying which: given Orca's default instead, and recorded.
ORCA_REFUSES = {"raft_first_layer_expansion": ("-1", "2")}


def run_orca(d, runs, filaments):
    substituted = []
    f = os.path.join(d, "orca/process.json")
    config = json.load(open(f))
    for key, (bad, good) in ORCA_REFUSES.items():
        if str(config.get(key)).strip("[]'\"") == bad:
            config[key] = good
            substituted.append({"key": key, "old_value": bad, "new_value": good})
    json.dump(config, open(f, "w"))
    root = os.path.join(ORCA, "squashfs-root")
    env = {"XDG_RUNTIME_DIR": "/tmp", "LD_LIBRARY_PATH": f"{root}/lib:{root}/usr/lib"}
    out = []
    o = os.path.join(d, "orca-out")
    for k in range(runs):
        shutil.rmtree(o, ignore_errors=True)
        os.makedirs(o)
        m = measure(
            CORES
            + [
                f"{root}/bin/orca-slicer",
                "--arrange",
                "0",
                "--load-settings",
                "orca/machine.json;orca/process.json",
                "--load-filaments",
                ";".join(f"orca/filament-{n + 1}.json" for n in range(filaments)),
                "--slice",
                "0",
                "--outputdir",
                "orca-out",
                "--export-statistics",
                "orca/plate.3mf",
            ],
            env=env,
            cwd=d,
        )
        result = os.path.join(o, "result.json")
        m["result"] = json.load(open(result)) if os.path.exists(result) else None
        m["substituted"] = substituted
        out.append(m)
        if not os.path.exists(os.path.join(o, "plate_1.gcode")):
            break
    return out


def median(values):
    values = [v for v in values if v is not None]
    return statistics.median(values) if values else None


def sweep_one(entry, corpus, out, runs, skip_orca, printer):
    name = entry["name"]
    path = os.path.join(corpus, name)
    d = os.path.join(out, slug(name))
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    row = {"name": name}
    sha = hashlib.sha256(open(path, "rb").read()).hexdigest()
    if sha != entry["sha256"]:
        row["note"] = f"sha256 {sha} isn't the manifest's"
    app = run_app(entry, path, d, printer)
    row["app"] = app["app"]
    if not os.path.exists(os.path.join(d, "job.json")):
        row["app_error"] = app["stderr"]
        return row
    setup = json.load(open(os.path.join(d, "setup.json")))
    filaments = len(setup["filaments"])
    row["filaments"] = filaments
    native = run_native(d, runs)
    row["native"] = {
        "code": native[-1]["code"],
        "stderr": native[-1]["stderr"][-1500:],
        "wall_ms": median([m["wall_ms"] for m in native if m["code"] == 0]),
        "peak_mb": max(m["peak_mb"] for m in native),
        "runs": len(native),
    }
    if native[-1]["code"] == 0:
        stats = json.load(open(os.path.join(d, "native.stats.json")))
        row["native"]["stats"] = stats["summary"]
        row["native"]["gcode"] = gcode_facts(os.path.join(d, "native.gcode"))
    wasm = run_wasm(d, runs)
    row["wasm"] = {
        "ok": "sliceMs" in wasm[-1],
        "slice_ms": median([r.get("sliceMs") for r in wasm]),
        "memory_mb": max((r.get("wasmMemoryMB") or 0) for r in wasm),
        "error": None if "sliceMs" in wasm[-1] else wasm[-1],
    }
    files = [os.path.join(d, f) for f in ("native.gcode.3mf", "wasm.gcode.3mf", "app.gcode.3mf")]
    sums = [hashlib.md5(open(f, "rb").read()).hexdigest() if os.path.exists(f) else None for f in files]
    row["identical"] = {"native_wasm": sums[0] is not None and sums[0] == sums[1], "native_app": sums[0] is not None and sums[0] == sums[2]}
    if not skip_orca:
        orca = run_orca(d, runs, filaments)
        last = orca[-1]
        gcode = os.path.join(d, "orca-out/plate_1.gcode")
        row["orca"] = {
            "code": last["code"],
            "wall_ms": median([m["wall_ms"] for m in orca if os.path.exists(gcode)]),
            "peak_mb": max(m["peak_mb"] for m in orca),
            "runs": len(orca),
            "result": {k: last["result"].get(k) for k in ("return_code", "error_string", "warnings")} if last["result"] else None,
            "substituted": last.get("substituted"),
            "stderr": last["stderr"][-600:],
        }
        if os.path.exists(gcode):
            row["orca"]["stats"] = json.load(open(os.path.join(d, "orca-out/plate_1.statistics.json")))["summary"]
            row["orca"]["gcode"] = gcode_facts(gcode)
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default=os.environ.get("REAL_MODELS"))
    ap.add_argument("--out", default=os.path.join(HERE, "out/sweep"))
    ap.add_argument("--only", default="")
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--skip-orca", action="store_true")
    ap.add_argument("--table", action="store_true", help="print the tables from results.json and stop")
    args = ap.parse_args()
    manifest = json.load(open(os.path.join(HERE, "real-models.json")))
    results_path = os.path.join(args.out, "results.json")
    results = json.load(open(results_path)) if os.path.exists(results_path) else {}
    if args.table:
        table(manifest, results)
        return
    os.makedirs(args.out, exist_ok=True)
    only = set(filter(None, args.only.split(",")))
    for entry in manifest["models"]:
        if only and entry["name"] not in only and slug(entry["name"]) not in only:
            continue
        print(f"{entry['name']} …", file=sys.stderr, flush=True)
        row = sweep_one(entry, args.corpus, args.out, args.runs, args.skip_orca, manifest["printer"])
        if args.skip_orca and entry["name"] in results and "orca" in results[entry["name"]]:
            row["orca"] = results[entry["name"]]["orca"]
        results[entry["name"]] = row
        json.dump(results, open(results_path, "w"), indent=1)
        print(summary_line(row), file=sys.stderr, flush=True)


def pct(a, b):
    if a is None or b in (None, 0):
        return "–"
    return f"{(a - b) / b * 100:+.1f} %".replace("-", "−")


def summary_line(row):
    n, o = row.get("native", {}), row.get("orca", {})
    if "stats" not in n:
        return f"  ours: {(row.get('app') or {}).get('ours')} {n.get('stderr', row.get('app_error', ''))[-300:]}"
    s = n["stats"]
    line = f"  ours {s['weight']:.2f} g {s['time'] / 60:.1f} min {n['wall_ms']:.0f} ms; same in wasm: {row['identical']}"
    if "stats" in o:
        line += f"; Orca {o['stats']['weight']:.2f} g ({pct(s['weight'], o['stats']['weight'])}) {o['stats']['time'] / 60:.1f} min ({pct(s['time'], o['stats']['time'])}) {o['wall_ms']:.0f} ms"
    elif o:
        line += f"; Orca failed: {o.get('result') or o.get('stderr')}"
    return line


FEATURE_ORDER = [
    "Outer wall",
    "Inner wall",
    "Overhang wall",
    "Sparse infill",
    "Internal solid infill",
    "Gap infill",
    "Top surface",
    "Bottom surface",
    "Bridge",
    "Internal Bridge",
    "Brim",
    "Skirt",
    "Support",
    "Support interface",
    "Support transition",
    "Prime tower",
    "Ironing",
]


def table(manifest, results):
    """The proposal's tables: one line per model, then each model's own."""
    print("| Model | Ours | Layers, ours / Orca | Filament, ours / Orca | Estimate, ours / Orca | Retractions, ours / Orca | Native, ours / Orca | WebAssembly |")
    print("| --- | --- | --- | --- | --- | --- | --- | --- |")
    for entry in manifest["models"]:
        row = results.get(entry["name"])
        if not row:
            continue
        n, o = row.get("native", {}), row.get("orca", {})
        ours = (row.get("app") or {}).get("ours") or {}
        if "stats" not in n:
            print(f"| {entry['label']} | refused: {ours.get('fallback') or n.get('stderr')} | | | | | | |")
            continue
        s, os_ = n["stats"], o.get("stats")
        slices = "slices" + ("" if row["identical"]["native_wasm"] and row["identical"]["native_app"] else " (WebAssembly differs)")
        if not os_:
            print(f"| {entry['label']} | {slices} | {s['layer_count']} / – | {s['weight']:.2f} g / – | {s['time'] / 60:.1f} min / – | | | |")
            continue
        w = row.get("wasm", {})
        print(
            f"| {entry['label']} | {slices} | {s['layer_count']} / {os_['layer_count']} "
            f"| {s['weight']:.2f} / {os_['weight']:.2f} g ({pct(s['weight'], os_['weight'])}) "
            f"| {s['time'] / 60:.1f} / {os_['time'] / 60:.1f} min ({pct(s['time'], os_['time'])}) "
            f"| {n['gcode']['retractions']:,} / {o['gcode']['retractions']:,} "
            f"| {n['wall_ms'] / 1000:.1f} / {o['wall_ms'] / 1000:.1f} s, {n['peak_mb']:.0f} / {o['peak_mb']:.0f} MB "
            f"| {w['slice_ms'] / 1000:.1f} s, {w['memory_mb']} MB |"
        )
    for entry in manifest["models"]:
        row = results.get(entry["name"])
        if not row or "stats" not in row.get("native", {}) or "stats" not in row.get("orca", {}):
            continue
        n, o = row["native"], row["orca"]
        s, os_ = n["stats"], o["stats"]
        t_r, t_o = split_time(s, False), split_time(os_, True)
        fr, fo = s["features"], os_["features"]
        print(f"\n**{entry['label']}.** {entry['what']}", end="")
        if o.get("substituted"):
            subs = ", ".join(f"{x['key']} {x['old_value']} as {x['new_value']}" for x in o["substituted"])
            print(f" Orca's command line refuses the project's {subs.split(' ')[0]}: it is given {subs.split(' as ')[-1]}, its default, which changes nothing here.", end="")
        print("\n")
        print("| | Ours | Orca 2.5.1 | Difference |")
        print("| --- | --- | --- | --- |")

        def line(label, a, b, fmt):
            print(f"| {label} | {fmt(a)} | {fmt(b)} | {pct(a, b)} |")

        line("Layers", s["layer_count"], os_["layer_count"], lambda v: f"{v}")
        names = [f for f in FEATURE_ORDER if f in fr or f in fo] + sorted((set(fr) | set(fo)) - set(FEATURE_ORDER))
        for f in names:
            line(f"{f}, mm³", fr.get(f, {}).get("volume", 0.0), fo.get(f, {}).get("volume", 0.0), lambda v: f"{v:,.0f}")
        line("Filament, g", s["weight"], os_["weight"], lambda v: f"{v:.2f}")
        line("Estimate, min", t_r["time"] / 60, t_o["time"] / 60, lambda v: f"{v:.1f}")
        line("Extruding, min", t_r["extruding"] / 60, t_o["extruding"] / 60, lambda v: f"{v:.1f}")
        line("Travel, retractions, lifts, min", t_r["moving"] / 60, t_o["moving"] / 60, lambda v: f"{v:.1f}")
        line("Retractions", n["gcode"]["retractions"], o["gcode"]["retractions"], lambda v: f"{v:,}")
        if row.get("filaments", 1) > 1:
            line("Tool changes", n["gcode"]["tool_changes"], o["gcode"]["tool_changes"], lambda v: f"{v:,}")
            flush = lambda stats: sum(f["flush"]["volume"] for f in stats.get("filaments", []))  # noqa: E731
            line("Flush, mm³", flush(s), flush(os_), lambda v: f"{v:,.0f}")


if __name__ == "__main__":
    main()
