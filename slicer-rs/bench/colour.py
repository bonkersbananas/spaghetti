"""Writes the two-colour benchmark model, placed on the X2D's plate: a block with an S cut through it and the S that
fills the cut, as two objects (each its own STL), so a plate prints both filaments on every layer, and Orca's
tool changes, flushing and prime tower can be compared with ours.

    python3 -I colour.py <out-folder> [--size 35 --height 10 --cell 3]

Writes <out>/block.stl and <out>/letter.stl, centred on the plate. Each is built from square cells on one grid, so
the two meshes are closed and share their walls exactly: tops and bottoms are a cell's two triangles, walls run
between a filled cell and an empty one. With --project, also <out>/block-and-s.3mf: a project with the two as parts
of one object, the block in filament 1 and the S in filament 2 (each part's `extruder` in model_settings.config)."""

import struct
import sys
import zipfile

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


def mesh_xml(tris, dx, dy):
    """A 3MF <mesh> of `tris`, moved by (dx, dy), its corners shared between triangles."""
    index, vertices, triangles = {}, [], []
    for t in tris:
        ids = []
        for x, y, z in t:
            key = (x + dx, y + dy, z)
            if key not in index:
                index[key] = len(vertices)
                vertices.append(key)
            ids.append(index[key])
        triangles.append(ids)
    v = "".join(f'<vertex x="{x:g}" y="{y:g}" z="{z:g}"/>' for x, y, z in vertices)
    t = "".join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in triangles)
    return f"<mesh><vertices>{v}</vertices><triangles>{t}</triangles></mesh>"


def project(path, parts, dx, dy):
    """A Bambu Studio or Orca project of one object whose parts are `parts`, part k printing in filament k + 1."""
    resources = "".join(f'<object id="{k + 1}" type="model">{mesh_xml(tris, dx, dy)}</object>' for k, tris in enumerate(parts))
    whole = len(parts) + 1
    components = "".join(f'<component objectid="{k + 1}"/>' for k in range(len(parts)))
    model = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
        f'<resources>{resources}<object id="{whole}" type="model"><components>{components}</components></object></resources>'
        f'<build><item objectid="{whole}"/></build></model>'
    )
    names = ["Block", "S"]
    part_settings = "".join(
        f'<part id="{k + 1}" subtype="normal_part"><metadata key="name" value="{names[k] if k < len(names) else k + 1}"/>'
        f'<metadata key="extruder" value="{k + 1}"/></part>'
        for k in range(len(parts))
    )
    settings = (
        '<?xml version="1.0" encoding="UTF-8"?>\n<config>'
        f'<object id="{whole}"><metadata key="name" value="Block with an S"/><metadata key="extruder" value="1"/>{part_settings}</object>'
        f'<plate><metadata key="plater_id" value="1"/><model_instance><metadata key="object_id" value="{whole}"/></model_instance></plate>'
        "</config>"
    )
    types = (
        '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
        "</Relationships>"
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", types)
        z.writestr("_rels/.rels", rels)
        z.writestr("3D/3dmodel.model", model)
        z.writestr("Metadata/model_settings.config", settings)


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
    if "--project" in args:
        project(f"{out}/block-and-s.3mf", [mesh(block, cell, height), mesh(letter, cell, height)], dx, dy)
    print(f"block {side:g} x {side:g} x {height:g} mm, the S {cols * cell:g} x {rows * cell:g} mm")


main()
