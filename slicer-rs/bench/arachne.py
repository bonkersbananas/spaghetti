"""Compares slicer-rs's Arachne walls with native OrcaSlicer's, shape by shape.

For each test shape (boxes and prisms unioned into one outline) it writes an STL, slices it with native Orca
(wall_generator = arachne, the app's X2D presets), reads the walls of one layer from the G-code (every extrusion
move with its width, from E, the layer height and the filament's cross-section), and prints the walls of
`cargo test dump_walls` for the same outline: how far each one's points lie from the other's lines, both ways,
and how much plastic each has. Needs ORCA_NATIVE (the extracted AppImage's squashfs-root).

    ORCA_NATIVE=~/orca-native/squashfs-root python3 -I bench/arachne.py
"""
import json, math, os, struct, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CRATE = os.path.dirname(HERE)
PROFILES = os.path.join(CRATE, "profiles", "x2d")
ORCA = os.environ.get("ORCA_NATIVE", os.path.expanduser("~/orca-native/squashfs-root"))
LAYER_HEIGHT = 0.2
FLOW_RATIO = 0.98  # the filament's flow ratio: E carries it, widths here don't
ORIGIN = 100.0  # shapes sit here on the plate

SHAPES = {
    "bar-20x1.2": [[(0, 0), (20, 0), (20, 1.2), (0, 1.2)]],
    "bar-20x0.8": [[(0, 0), (20, 0), (20, 0.8), (0, 0.8)]],
    "bar-20x2": [[(0, 0), (20, 0), (20, 2), (0, 2)]],
    "plate-20x10": [[(0, 0), (20, 0), (20, 10), (0, 10)]],
    "wedge": [[(0, 0), (20, 0), (20, 3)]],
    "taper": [[(0, 0), (20, 0), (20, 1.4), (0, 0.2)]],
    "L": [[(0, 0), (10, 0), (10, 1), (0, 1)], [(0, 0), (1, 0), (1, 10), (0, 10)]],
    "T": [[(-3, 6), (4, 6), (4, 7.2), (-3, 7.2)], [(0, 0), (1, 0), (1, 6.1), (0, 6.1)]],
}


def stl(polys, height, path):
    tris = []
    for poly in polys:  # convex, counter-clockwise: a fan
        pts = [(ORIGIN + x, ORIGIN + y) for x, y in poly]
        for i in range(1, len(pts) - 1):
            a, b, c = pts[0], pts[i], pts[i + 1]
            tris.append(((a[0], a[1], height), (b[0], b[1], height), (c[0], c[1], height)))
            tris.append(((a[0], a[1], 0), (c[0], c[1], 0), (b[0], b[1], 0)))
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            tris.append(((a[0], a[1], 0), (b[0], b[1], 0), (b[0], b[1], height)))
            tris.append(((a[0], a[1], 0), (b[0], b[1], height), (a[0], a[1], height)))
    with open(path, "wb") as f:
        f.write(b"\0" * 80 + struct.pack("<I", len(tris)))
        for t in tris:
            f.write(struct.pack("<12fH", 0, 0, 0, *t[0], *t[1], *t[2], 0))


def orca_walls(polys, work, layer):
    stl(polys, 2.0, os.path.join(work, "shape.stl"))
    process = json.load(open(os.path.join(PROFILES, "process.json")))
    process["wall_generator"] = "arachne"
    process["wall_loops"] = "2"
    json.dump(process, open(os.path.join(work, "process.json"), "w"))
    machine = json.load(open(os.path.join(PROFILES, "machine.json")))
    machine["curr_bed_type"] = "Textured PEI Plate"
    json.dump(machine, open(os.path.join(work, "machine.json"), "w"))
    filament = os.path.join(PROFILES, "filament.json")
    env = dict(os.environ, LD_LIBRARY_PATH=os.path.join(ORCA, "lib"))
    subprocess.run(
        [os.path.join(ORCA, "bin", "orca-slicer"), "--load-settings", "machine.json;process.json", "--load-filaments", filament,
         "--arrange", "0", "--slice", "1", "--outputdir", "out", "shape.stl"],
        cwd=work, env=env, check=True, capture_output=True)
    cross = math.pi * 1.75 ** 2 / 4
    segs, cur_layer, pos, typ = [], -1, None, None
    for line in open(os.path.join(work, "out", "plate_1.gcode")):
        if line.startswith("; CHANGE_LAYER"):
            cur_layer += 1
        elif line.startswith("; FEATURE:"):
            typ = line[10:].strip()
        elif line.startswith("G1") and cur_layer == layer:
            w = dict((t[0], float(t[1:])) for t in line.split()[1:] if t[0] in "XYEZ")
            if "X" in w and "Y" in w:
                new = (w["X"] - ORIGIN, w["Y"] - ORIGIN)
                if "E" in w and w["E"] > 0 and pos is not None and "wall" in (typ or "").lower():
                    length = math.dist(pos, new)
                    segs.append((pos, new, w["E"] / FLOW_RATIO * cross / length / LAYER_HEIGHT + LAYER_HEIGHT * (1 - math.pi / 4)))
                pos = new
            elif "X" in w or "Y" in w:
                pass
    return segs


def our_walls(polys, work):
    # Our outline is the union of the polys: for the compare, each shape here is one convex piece or two that overlap,
    # so give the dump the union through the pieces' outline by shapely-free means: one polygon per line, unioned by
    # the slicer (it unions the contours as an outline).
    path = os.path.join(work, "shape.txt")
    with open(path, "w") as f:
        for poly in polys:
            f.write(" ".join(f"{x} {y}" for x, y in poly) + "\n")
    out = subprocess.run(
        ["cargo", "test", "--lib", "--release", "dump_walls", "--", "--ignored", "--nocapture", "--test-threads=1"],
        cwd=CRATE, env=dict(os.environ, ARACHNE_SHAPE=path), check=True, capture_output=True, text=True).stdout
    lines, cur = [], None
    for l in out.splitlines():
        if l.rstrip().endswith(tuple(f" {a} {b} {c}" for a in range(0, 4) for b in (0, 1) for c in (0, 1))) and "line " in l and l.count(" ") >= 3 and not l[0].isdigit() and not l[0] == "-":
            cur = []
            lines.append(cur)
        elif cur is not None and l.count(" ") == 2:
            try:
                cur.append(tuple(float(t) for t in l.split()))
            except ValueError:
                pass
    return lines


def seg_dist(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    t = 0 if l2 == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
    return math.dist(p, (a[0] + t * dx, a[1] + t * dy))


def far(points, segs):
    return max((min(seg_dist(p, a, b) for a, b in segs) for p in points), default=0)


def main():
    only = sys.argv[1:]
    for name, polys in SHAPES.items():
        if only and name not in only:
            continue
        with tempfile.TemporaryDirectory() as work:
            o = orca_walls(polys, work, 4)
            ours = our_walls(polys, work)
        osegs = [(a, b) for a, b, _ in o]
        usegs = [((l[i][0], l[i][1]), (l[i + 1][0], l[i + 1][1])) for l in ours for i in range(len(l) - 1)]
        oplastic = sum(math.dist(a, b) * w for a, b, w in o)
        uplastic = sum(math.dist((l[i][0], l[i][1]), (l[i + 1][0], l[i + 1][1])) * ((l[i][2] + l[i + 1][2]) / 2 + LAYER_HEIGHT * (1 - math.pi / 4)) for l in ours for i in range(len(l) - 1))
        opts = [p for a, b in osegs for p in (a, b)]
        upts = [(p[0], p[1]) for l in ours for p in l]
        print(f"{name}: orca {len(osegs)} moves, ours {len(usegs)}; every Orca point within {far(opts, usegs):.3f} mm of ours, "
              f"every point of ours within {far(upts, osegs):.3f} mm of Orca's; line length x width: Orca {oplastic:.3f}, ours {uplastic:.3f}")


main()
