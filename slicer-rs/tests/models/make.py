"""Writes the test models: python3 -I make.py (from this folder). bridge.stl: two 10 mm pillars 20 mm apart under
a 3 mm beam, as three touching boxes, for walls, infill, top and bottom surfaces and a bridge."""

import struct

BOXES = [((0, 0, 0), (10, 10, 10)), ((30, 0, 0), (40, 10, 10)), ((0, 0, 10), (40, 10, 13))]


def box(lo, hi):
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    # Counter-clockwise seen from outside.
    faces = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    return [(v[a], v[b], v[c]) for a, b, c in faces]


triangles = [t for lo, hi in BOXES for t in box(lo, hi)]
with open("bridge.stl", "wb") as f:
    f.write(b"spaghetti slicer test model: a bridge".ljust(80, b" "))
    f.write(struct.pack("<I", len(triangles)))
    for t in triangles:
        f.write(struct.pack("<3f", 0, 0, 0))
        for p in t:
            f.write(struct.pack("<3f", *p))
        f.write(b"\0\0")
print(len(triangles), "triangles")
