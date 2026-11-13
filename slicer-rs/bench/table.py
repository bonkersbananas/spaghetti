"""Prints the benchmark's tables (Markdown) from out/results.json: python3 -I table.py."""

import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
results = json.load(open(os.path.join(HERE, "out/results.json")))
MODELS = [("benchy", "3DBenchy", "225,154"), ("glasses", "Steampunk glasses", "30,080"), ("uobf", "UOBF text with clips", "1,354"), ("plate", "12 Benchies, one plate", "2,701,848")]
RUNNERS = [
    ("rust-native", "Rust, native, 4 threads"),
    ("rust-native-1t", "Rust, native, 1 thread"),
    ("rust-wasm-node", "Rust, WebAssembly, Node"),
    ("rust-wasm-chromium", "Rust, WebAssembly, Chromium"),
    ("orca-native", "Orca 2.5.0, native, 4 threads"),
    ("orca-wasm-node", "Orca engine, WebAssembly, Node"),
    ("orca-wasm-chromium", "Orca engine, WebAssembly, Chromium"),
]


def secs(ms):
    return f"{ms / 1000:.2f} s" if ms < 10000 else f"{ms / 1000:.1f} s"


def size(b):
    return f"{b / 1e6:.2f} MB" if b >= 1e6 else f"{b / 1e3:.0f} kB"


print("| Runner | " + " | ".join(m[1] for m in MODELS) + " |")
print("| --- |" + " --- |" * len(MODELS))
for key, label in RUNNERS:
    cells = []
    for m, _, _ in MODELS:
        e = results.get(m, {}).get(key)
        cells.append(f"{secs(e['wall_ms'])}, {e['peak_mb']:.0f} MB" if e and "wall_ms" in e else "–")
    print(f"| {label} | " + " | ".join(cells) + " |")

print()
print("| Model | Rust `.gcode.3mf` | Orca's G-code, packed as the app packs it | Rust G-code | Orca G-code |")
print("| --- | --- | --- | --- | --- |")
for m, label, _ in MODELS:
    r = results[m]["rust-native"]["runs"][0]
    o = results[m]["orca-native"]["runs"][0]
    print(f"| {label} | {size(r['file_bytes'])} | {size(o['file_bytes_estimate'])} | {size(r['gcode_bytes'])} | {size(o['gcode_bytes'])} |")

print()
print("| Model | Layers, Rust / Orca | Filament, Rust / Orca | Printing time, Rust / Orca | Retractions, Rust / Orca |")
print("| --- | --- | --- | --- | --- |")


def retractions(path):
    """Each retraction ends with the filament pushed back: count those (a plain `G1 E<positive>`)."""
    n = 0
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("G1 E") and not line.startswith("G1 E-"):
                n += 1
    return n


for m, label, _ in MODELS:
    r = results[m]["rust-native"]["runs"][0]
    o = results[m]["orca-native"]["runs"][0]
    print(f"| {label} | {size(r['file_bytes'])} | {size(o['file_bytes_estimate'])} | {size(r['gcode_bytes'])} | {size(o['gcode_bytes'])} |")

print()
print("| Model | Layers, Rust / Orca | Filament, Rust / Orca | Printing time, Rust / Orca | Retractions, Rust / Orca |")
print("| --- | --- | --- | --- | --- |")


def retractions(path):
    n = 0
    prev_wipe = False
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("; WIPE_START"):
                n += 1
                prev_wipe = True
            elif line.startswith("G1 E-"):
                if not prev_wipe:
                    n += 1
                prev_wipe = False
            elif line.startswith("G1 ") and " E" not in line:
                prev_wipe = False
    return n


for m, label, _ in MODELS:
    r = results[m]["rust-native"]["runs"][0]["stats"]
    o = results[m]["orca-native"]["runs"][0]["stats"]
    o_model = o["time"] - o["prepare_time"]
    dt = (r["model_time"] - o_model) / o_model * 100
    dg = (r["weight"] - o["weight"]) / o["weight"] * 100
    orca_retractions = retractions(results[m]["orca-native"]["runs"][0]["gcode"])
    print(
        f"| {label} | {r['layer_count']} / {o['layer_count']} | {r['weight']:.2f} g / {o['weight']:.2f} g ({dg:+.1f} %) | "
        f"{r['model_time'] / 60:.1f} / {o_model / 60:.1f} min ({dt:+.1f} %) | {retractions(results[m]["rust-native"]["runs"][0]["gcode"])} / {orca_retractions} |"
    )
