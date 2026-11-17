"""Supports against native OrcaSlicer 2.5.1: each model sliced with each support style as the app slices it (the
real-models sweep's machinery, bench/sweep.py), with the support settings overridden, then ours (native, one run) and
Orca's command line on the same plate, compared on the support's plastic and time.

  python3 -I bench/supports.py --corpus DIR [--out DIR] [--only MODEL,...] [--styles A,B] [--runs N]
  python3 -I bench/supports.py --table

A case is "<model>/<style>"; `STYLES` names each style's slicing settings (the app's) and any process keys set
beyond them (tree_support_wall_count 2...). Models are named by file (3DBenchy.stl, Glasses_Steampunk_Ontaeder.stl...)
and come from DIR, which stays out of the repository. The model's own slicing is real-models.json's (or Benchy's
defaults), with `supports` and `supportStyle` replaced.
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sweep  # noqa: E402

# style -> (slicing overrides, process keys to set in both slicers' configs)
STYLES = {
    "organic": ({"supports": "everywhere", "supportStyle": "tree"}, {}),
    "organic-wall2": ({"supports": "everywhere", "supportStyle": "tree"}, {"tree_support_wall_count": "2"}),
    "slim": ({"supports": "everywhere", "supportStyle": "tree-slim"}, {}),
    "strong": ({"supports": "everywhere", "supportStyle": "tree-strong"}, {}),
    "hybrid": ({"supports": "everywhere", "supportStyle": "tree-hybrid"}, {}),
    "normal": ({"supports": "everywhere", "supportStyle": "normal"}, {}),
    "snug": ({"supports": "everywhere", "supportStyle": "snug"}, {}),
}

DEFAULT = {
    "layerHeight": 0.2,
    "walls": 2,
    "infill": 15,
    "pattern": "crosshatch",
    "supports": "off",
    "supportStyle": "tree",
    "brim": "auto",
    "filaments": [{"material": "PLA"}],
    "plate": "Textured PEI Plate",
    "nozzle": 0.4,
    "nozzlePicked": True,
    "scale": 100,
    "orientation": None,
    "slicer": "spaghetti",
}


def set_keys(d, keys):
    """The process keys, in the job's setup and in the presets native Orca reads."""
    if not keys:
        return
    p = os.path.join(d, "setup.json")
    j = json.load(open(p))
    j["process"].update(keys)
    json.dump(j, open(p, "w"))
    p = os.path.join(d, "orca/process.json")
    j = json.load(open(p))
    j.update(keys)
    json.dump(j, open(p, "w"))


def one(manifest, entry, style, corpus, out, runs, printer):
    over, keys = STYLES[style]
    e = dict(entry)
    e["slicing"] = dict(entry.get("slicing") or DEFAULT)
    e["slicing"].update(over)
    e["name"] = entry["name"]
    d = os.path.join(out, sweep.slug(entry["name"]) + "-" + style)
    return sweep_one_with_keys(e, corpus, d, runs, printer, keys)


def sweep_one_with_keys(entry, corpus, d, runs, printer, keys):
    import hashlib
    import shutil

    path = os.path.join(corpus, entry["name"])
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    row = {"name": entry["name"]}
    app = sweep.run_app(entry, path, d, printer)
    row["app"] = app["app"]
    if not os.path.exists(os.path.join(d, "job.json")):
        row["app_error"] = app["stderr"]
        return row
    set_keys(d, keys)
    setup = json.load(open(os.path.join(d, "setup.json")))
    filaments = len(setup["filaments"])
    native = sweep.run_native(d, runs)
    row["native"] = {"code": native[-1]["code"], "stderr": native[-1]["stderr"][-1500:], "wall_ms": sweep.median([m["wall_ms"] for m in native if m["code"] == 0])}
    if native[-1]["code"] == 0:
        stats = json.load(open(os.path.join(d, "native.stats.json")))
        row["native"]["stats"] = stats["summary"]
        row["native"]["gcode"] = sweep.gcode_facts(os.path.join(d, "native.gcode"))
    row["identical"] = {}
    orca = sweep.run_orca(d, runs, filaments)
    last = orca[-1]
    gcode = os.path.join(d, "orca-out/plate_1.gcode")
    row["orca"] = {
        "code": last["code"],
        "wall_ms": sweep.median([m["wall_ms"] for m in orca if os.path.exists(gcode)]),
        "result": {k: last["result"].get(k) for k in ("return_code", "error_string", "warnings")} if last["result"] else None,
        "stderr": last["stderr"][-600:],
    }
    if os.path.exists(gcode):
        row["orca"]["stats"] = json.load(open(os.path.join(d, "orca-out/plate_1.statistics.json")))["summary"]
        row["orca"]["gcode"] = sweep.gcode_facts(gcode)
    return row


def cell(row, feature):
    n = row.get("native", {}).get("gcode")
    o = row.get("orca", {}).get("gcode")
    if not n or not o:
        return "–"
    a, b = n["features_mm3"].get(feature, 0.0), o["features_mm3"].get(feature, 0.0)
    return f"{a:,.0f} / {b:,.0f} ({sweep.pct(a, b)})" if b else f"{a:,.0f} / 0"


def table(results):
    print("| Case | Support, ours / Orca (mm³) | Interface, ours / Orca (mm³) | Estimate, ours / Orca (min) | Retractions, ours / Orca |")
    print("| --- | --- | --- | --- | --- |")
    for k, row in results.items():
        n, o = row.get("native", {}), row.get("orca", {})
        if "stats" not in n or "stats" not in o:
            print(f"| {k} | failed: {(o.get('result') or o.get('stderr') or row.get('app_error') or n.get('stderr') or '')!s:.120} | | | |")
            continue
        t = f"{n['stats']['time'] / 60:.1f} / {o['stats']['time'] / 60:.1f} ({sweep.pct(n['stats']['time'], o['stats']['time'])})"
        r = f"{n['gcode']['retractions']} / {o['gcode']['retractions']}"
        print(f"| {k} | {cell(row, 'Support')} | {cell(row, 'Support interface')} | {t} | {r} |")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default=os.environ.get("REAL_MODELS"))
    ap.add_argument("--out", default=os.path.join(HERE, "out/supports"))
    ap.add_argument("--only", default="")
    ap.add_argument("--styles", default="")
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--table", action="store_true")
    args = ap.parse_args()
    results_path = os.path.join(args.out, "results.json")
    results = json.load(open(results_path)) if os.path.exists(results_path) else {}
    if args.table:
        table(results)
        return
    manifest = json.load(open(os.path.join(HERE, "real-models.json")))
    entries = {m["name"]: m for m in manifest["models"]}
    entries["3DBenchy.stl"] = {"name": "3DBenchy.stl"}
    only = [x for x in args.only.split(",") if x] or ["3DBenchy.stl", "Glasses_Steampunk_Ontaeder.stl"]
    styles = [x for x in args.styles.split(",") if x] or list(STYLES)
    os.makedirs(args.out, exist_ok=True)
    for name in only:
        for style in styles:
            key = f"{name}/{style}"
            print(key, "…", file=sys.stderr, flush=True)
            row = one(manifest, entries[name], style, args.corpus, args.out, args.runs, manifest["printer"])
            results[key] = row
            json.dump(results, open(results_path, "w"), indent=1)
            print(sweep.summary_line(row), file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
