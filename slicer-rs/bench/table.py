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


def retractions(path):
    """Each retraction ends with the filament pushed back, a plain `G1 E<positive>`: count those."""
    with open(path, encoding="utf-8", errors="replace") as f:
        return sum(1 for line in f if line.startswith("G1 E") and not line.startswith("G1 E-"))


print()
print(
    "| Model | Layers, Rust / Orca | Filament, Rust / Orca | Estimate, Rust / Orca | Extruding, Rust / Orca "
    "| Travel, retractions and lifts, Rust / Orca | Retractions, Rust / Orca |"
)
print("| --- | --- | --- | --- | --- | --- | --- |")


def pct(a, b):
    return f"{(a - b) / b * 100:+.1f} %".replace("-", "−")


for m, label, _ in MODELS:
    r = results[m]["rust-native"]["runs"][0]
    o = results[m]["orca-native"]["runs"][0]
    rs, os_ = r["stats"], o["stats"]
    # The same split for both: the time spent extruding (every feature's time), and the rest of the print after its
    # start (travel, retractions, wipes and lifts). Orca's own travel time also counts most of the start's moves.
    r_extruding = sum(f["time"] for f in rs["features"].values())
    o_extruding = sum(f["time"] for f in os_["features"].values())
    r_moving = rs["model_time"] - r_extruding
    o_moving = os_["time"] - os_["prepare_time"] - o_extruding
    print(
        f"| {label} | {rs['layer_count']} / {os_['layer_count']} "
        f"| {rs['weight']:.2f} g / {os_['weight']:.2f} g ({pct(rs['weight'], os_['weight'])}) "
        f"| {rs['time'] / 60:.1f} / {os_['time'] / 60:.1f} min ({pct(rs['time'], os_['time'])}) "
        f"| {r_extruding / 60:.1f} / {o_extruding / 60:.1f} min ({pct(r_extruding, o_extruding)}) "
        f"| {r_moving / 60:.1f} / {o_moving / 60:.1f} min ({pct(r_moving, o_moving)}) "
        f"| {retractions(r['gcode']):,} / {retractions(o['gcode']):,} |"
    )
