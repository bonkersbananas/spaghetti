"""Writes models placed on the X2D's plate as binary STLs, so every slicer in the benchmark slices the same
geometry in the same place: one model centred, or copies of it in a grid with 6 mm gaps (centred too).

    python3 -I place.py <model.stl> <out.stl> [--copies N --columns C] [--rotate-z DEG]

With copies, each copy is its own file (<out>-1.stl, <out>-2.stl, …): one object each, as on a real plate."""

import math
import struct
import sys

BED = 256.0
GAP = 6.0


def read_stl(path):
    data = open(path, "rb").read()
    if len(data) >= 84:
        count = struct.unpack_from("<I", data, 80)[0]
        if 84 + count * 50 == len(data):
            tris = []
            for t in range(count):
                v = struct.unpack_from("<9f", data, 84 + t * 50 + 12)
                tris.append(v)
            return tris
    text = data.decode("utf-8", "replace").split()
    coords = [float(text[i + 1]) for i in range(len(text)) if text[i] == "vertex" for _ in [0]]
    # "vertex x y z": the three numbers after each "vertex".
    coords = []
    for i, word in enumerate(text):
        if word == "vertex":
            coords.extend(float(x) for x in text[i + 1 : i + 4])
    return [tuple(coords[k : k + 9]) for k in range(0, len(coords) - 8, 9)]


def bounds(tris):
    xs = [v for t in tris for v in t[0::3]]
    ys = [v for t in tris for v in t[1::3]]
    zs = [v for t in tris for v in t[2::3]]
    return min(xs), min(ys), min(zs), max(xs), max(ys), max(zs)


def moved(tris, dx, dy, dz):
    return [tuple(v + (dx, dy, dz)[k % 3] for k, v in enumerate(t)) for t in tris]


def rotated_z(tris, degrees):
    a = math.radians(degrees)
    c, s = math.cos(a), math.sin(a)
    out = []
    for t in tris:
        p = []
        for k in range(3):
            x, y, z = t[3 * k : 3 * k + 3]
            p.extend((x * c - y * s, x * s + y * c, z))
        out.append(tuple(p))
    return out


def write_stl(path, tris):
    with open(path, "wb") as f:
        f.write(b"placed for the slicer benchmark".ljust(80, b" "))
        f.write(struct.pack("<I", len(tris)))
        for t in tris:
            f.write(struct.pack("<12fH", 0.0, 0.0, 0.0, *t, 0))


def main():
    args = sys.argv[1:]
    copies = int(args[args.index("--copies") + 1]) if "--copies" in args else 1
    columns = int(args[args.index("--columns") + 1]) if "--columns" in args else copies
    rotate = float(args[args.index("--rotate-z") + 1]) if "--rotate-z" in args else 0.0
    model, out = [a for i, a in enumerate(args) if not a.startswith("--") and (i == 0 or not args[i - 1].startswith("--"))][:2]
    tris = read_stl(model)
    if rotate:
        tris = rotated_z(tris, rotate)
    x0, y0, z0, x1, y1, z1 = bounds(tris)
    w, d = x1 - x0, y1 - y0
    rows = math.ceil(copies / columns)
    total_w = columns * w + (columns - 1) * GAP
    total_d = rows * d + (rows - 1) * GAP
    if total_w > BED or total_d > BED:
        sys.exit(f"{copies} copies in {columns} columns need {total_w:.0f} x {total_d:.0f} mm")
    left = BED / 2 - total_w / 2
    back = BED / 2 + total_d / 2
    for k in range(copies):
        r, c = divmod(k, columns)
        dx = left + c * (w + GAP) - x0
        dy = back - (r + 1) * d - r * GAP - y0
        path = out if copies == 1 else out.replace(".stl", f"-{k + 1}.stl")
        write_stl(path, moved(tris, dx, dy, -z0))
    print(f"{copies} x {len(tris)} triangles, {w:.1f} x {d:.1f} x {z1 - z0:.1f} mm")


main()
