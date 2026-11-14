"""Plates in several filaments, against native Orca: how it puts the filaments on the X2D's two nozzles, and what
follows from that (each tool change with its flush, each filament's grams, the estimate).

    python3 -I groups.py [--plates N] [--seed S] [--filaments 3,4,…] [--x0 MM]

Each plate is 15 mm blocks, one per filament, in random colours of the app's palette and random heights, four to a
row from (x0, 20) mm 30 mm apart, with the prime tower at (150, 90). With the default x0 of 20 mm the first column
reaches into the strip the right nozzle can't print (x under 20.5 mm), so their filaments must stay on the left one;
at 80 mm the blocks stand clear of it. Both slicers slice the blocks where they stand, each block in its filament:
ours from ../target/release/spaghetti-slicer, Orca 2.5's command line from $ORCA_NATIVE with the presets in
$ORCA_PRESETS, as run.py runs them. Files go to out/groups/."""

import json
import os
import random
import re
import shutil
import struct
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CRATE = os.path.dirname(HERE)
OUT = os.path.join(HERE, "out", "groups")
SPIKE = os.environ.get("ORCA_SPIKE", "/home/agent/build/spike")
PRESETS = os.environ.get("ORCA_PRESETS", SPIKE)
NATIVE = os.environ.get("ORCA_NATIVE", "/home/agent/build/orca-native")
BIN = os.path.join(CRATE, "target/release/spaghetti-slicer")
PALETTE = ["#FFFFFF", "#000000", "#F2754E", "#4F7FC7", "#FFE600", "#C12E1F", "#00AE42", "#8E9089", "#F7D4E0", "#5B3A29"]
TOWER = ["150", "90"]


def block(path, x, y, size, h):
    """A box as a binary STL."""
    v = [(x, y, 0), (x + size, y, 0), (x + size, y + size, 0), (x, y + size, 0),
         (x, y, h), (x + size, y, h), (x + size, y + size, h), (x, y + size, h)]
    faces = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5),
             (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    with open(path, "wb") as out:
        out.write(b"\0" * 80 + struct.pack("<I", len(faces)))
        for face in faces:
            out.write(struct.pack("<3f", 0, 0, 0))
            for i in face:
                out.write(struct.pack("<3f", *v[i]))
            out.write(b"\0\0")


def facts(path):
    """A G-code file's filament map, its tool changes (each one's filament and flush length), grams and estimate."""
    fmap, changes, pending, grams, estimate = None, [], None, None, None
    for line in open(path):
        if line.startswith("; filament_map = ") and fmap is None:
            fmap = line.split("= ")[1].strip()
        m = re.match(r"M620 S(\d+)A", line)
        if m:
            pending = int(m.group(1))
        elif pending is not None and line.startswith("M620.10 A1"):
            m = re.search(r" L([\d.]+)", line)
            changes.append((pending, m.group(1) if m else None))
            pending = None
        elif line.startswith("; filament used [g] ="):
            grams = [float(g) for g in line.split("=")[1].split(",")]
        elif line.startswith("; model printing time") and estimate is None:
            words = line.split("total estimated time:")[1]
            estimate = sum(int(n) * s for n, s in ((m.group(1), {"h": 3600, "m": 60, "s": 1}[m.group(2)])
                                                   for m in re.finditer(r"(\d+)([hms])", words)))
    return fmap, changes, grams, estimate


def plate(name, colours, heights, x0):
    d = os.path.join(OUT, name)
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(os.path.join(d, "orca"))
    files = []
    for k, h in enumerate(heights):
        files.append(os.path.join(d, f"block-{k + 1}.stl"))
        block(files[-1], x0 + 30 * (k % 4), 20 + 30 * (k // 4), 15, h)
    names = []
    for k, colour in enumerate(colours):
        f = json.load(open(f"{PRESETS}/filament.json"))
        f["filament_colour"] = [colour]
        names.append(os.path.join(d, f"filament-{k + 1}.json"))
        json.dump(f, open(names[-1], "w"))
    process = json.load(open(f"{PRESETS}/process.json"))
    process["wipe_tower_x"], process["wipe_tower_y"] = [TOWER[0]], [TOWER[1]]
    json.dump(process, open(os.path.join(d, "process.json"), "w"))
    ids = ",".join(str(k + 1) for k in range(len(heights)))
    root = os.path.join(NATIVE, "squashfs-root")
    os.makedirs("/tmp/xdg", exist_ok=True)
    env = dict(os.environ, XDG_RUNTIME_DIR="/tmp/xdg", LD_LIBRARY_PATH=f"{NATIVE}/stubs:{root}/lib:{root}/usr/lib")
    subprocess.run([f"{root}/bin/orca-slicer", "--arrange", "0", "--load-settings",
                    f"{PRESETS}/machine.json;{d}/process.json", "--load-filaments", ";".join(names), "--slice", "0",
                    "--outputdir", os.path.join(d, "orca"), "--load-filament-ids", ids] + files,
                   env=env, capture_output=True, check=False)
    setup = {"filaments": [{} for _ in colours], "colours": colours,
             "process": {"wipe_tower_x": [TOWER[0]], "wipe_tower_y": [TOWER[1]]}}
    json.dump(setup, open(os.path.join(d, "setup.json"), "w"))
    subprocess.run([BIN, "--setup", os.path.join(d, "setup.json"), "--keep-placement", "--filaments", ids] + files
                   + ["-o", os.path.join(d, "ours.gcode.3mf"), "--gcode", os.path.join(d, "ours.gcode")],
                   capture_output=True, check=False)
    orca_file = os.path.join(d, "orca", "plate_1.gcode")
    if not os.path.exists(orca_file):
        return None
    return facts(orca_file), facts(os.path.join(d, "ours.gcode"))


def main():
    args = sys.argv[1:]
    opt = lambda name, default: args[args.index(name) + 1] if name in args else default
    plates, seed = int(opt("--plates", "10")), int(opt("--seed", "1"))
    sizes = [int(n) for n in opt("--filaments", "3,4,5,6,7,8").split(",")]
    x0 = float(opt("--x0", "20"))
    random.seed(seed)
    same_maps = same_changes = 0
    worst_grams, estimates = 0.0, []
    for k in range(plates):
        n = random.choice(sizes)
        colours, heights = random.sample(PALETTE, n), [random.choice([4, 6, 8, 10]) for _ in range(n)]
        got = plate(f"plate-{k}", colours, heights, x0)
        if got is None:
            print(f"plate-{k}: Orca refused it")
            continue
        (omap, ochanges, ograms, oest), (map_, changes, grams, est) = got
        same_maps += omap == map_
        same_changes += ochanges == changes
        worst = max(abs(a - b) for a, b in zip(ograms, grams))
        worst_grams = max(worst_grams, worst)
        estimates.append(100 * (est - oest) / oest)
        print(f"plate-{k}: {n} filaments, map Orca {omap} ours {map_}, changes {'same' if ochanges == changes else 'differ'}"
              f" ({len(changes)}), grams within {worst:.2f} g, estimate {estimates[-1]:+.2f} %")
    print(f"{same_maps} of {plates} maps as Orca's, {same_changes} with every change and flush as Orca's; grams within"
          f" {worst_grams:.2f} g; estimate {min(estimates):+.2f} to {max(estimates):+.2f} %")


if __name__ == "__main__":
    main()
