"""Writes the two-colour benchmark model, placed on the X2D's plate: a block with an S cut through it and the S that
fills the cut, as two objects (each its own STL), so a plate prints both filaments on every layer, and Orca's
tool changes, flushing and prime tower can be compared with ours.

    python3 -I colour.py <out-folder> [--size 35 --height 10 --cell 3]

Writes <out>/block.stl and <out>/letter.stl, centred on the plate. Each is built from square cells on one grid, so
the two meshes are closed and share their walls exactly: tops and bottoms are a cell's two triangles, walls run
between a filled cell and an empty one."""

import struct
import sys

BED = 256.0
# The S, row by row from the back (largest y) to the front.
GLYPH = ["#####", "#....", "#####", "....#", "#####"]


def mesh(cells, cell, z1):
    """Triangles of the prism over `cells` (a set of (i, j) grid squares `cell` mm wide) from z 0 to `z1`."""
    tris = []
    for i, j in cells:
        x0, y0, x1, y1 = i * cell, j * cell, (i + 1) * cell, (j + 1) * cell
        # Bottom, seen from below, and top, seen from above: counter-clockwise from outside.
        tris.append(((x0, y0, 0), (x1, y1, 0), (x1, y0, 0)))
        tris.append(((x0, y0, 0), (x0, y1, 0), (x1, y1, 0)))
        tris.append(((x0, y0, z1), (x1, y0, z1), (x1, y1, z1)))
        tris.append(((x0, y0, z1), (x1, y1, z1), (x0, y1, z1)))
        # Walls where the neighbour is empty, facing it.
        for (di, dj), (a, b) in (
            ((1, 0), ((x1, y0), (x1, y1))),
            ((-1, 0), ((x0, y1), (x0, y0))),
            ((0, 1), ((x1, y1), (x0, y1))),
            ((0, -1), ((x0, y0), (x1, y0))),
        ):
            if (i + di, j + dj) in cells:
                continue
            tris.append(((*a, 0), (*b, 0), (*b, z1)))
            tris.append(((*a, 0), (*b, z1), (*a, z1)))
    return tris


def write(path, name, tris, dx, dy):
    with open(path, "wb") as f:
        f.write(f"spaghetti slicer benchmark: {name}".encode().ljust(80, b" "))
        f.write(struct.pack("<I", len(tris)))
        for t in tris:
            f.write(struct.pack("<3f", 0, 0, 0))
            for x, y, z in t:
                f.write(struct.pack("<3f", x + dx, y + dy, z))
            f.write(b"\0\0")


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(2)
    out = args[0]
    opt = lambda name, default: float(args[args.index(name) + 1]) if name in args else default
    size, height, cell = opt("--size", 35.0), opt("--height", 10.0), opt("--cell", 3.0)
    n = int(round(size / cell))
    rows = len(GLYPH)
    cols = len(GLYPH[0])
    # The glyph in the middle of the block's grid.
    oi, oj = (n - cols) // 2, (n - rows) // 2
    letter = {(oi + c, oj + rows - 1 - r) for r, row in enumerate(GLYPH) for c, ch in enumerate(row) if ch == "#"}
    block = {(i, j) for i in range(n) for j in range(n)} - letter
    side = n * cell
    dx, dy = (BED - side) / 2, (BED - side) / 2
    write(f"{out}/block.stl", "a block with an S cut through it", mesh(block, cell, height), dx, dy)
    write(f"{out}/letter.stl", "the S", mesh(letter, cell, height), dx, dy)
    print(f"block {side:g} x {side:g} x {height:g} mm, the S {cols * cell:g} x {rows * cell:g} mm")


main()
