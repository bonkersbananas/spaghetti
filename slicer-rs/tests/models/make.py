"""Writes the test models: python3 -I make.py (from this folder). bridge.stl: two 10 mm pillars 20 mm apart under
a 3 mm beam, as three touching boxes, for walls, infill, top and bottom surfaces and a bridge. two-colours.3mf: a
frame and the square that fills it, in two filaments."""

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

# two-colours.3mf: a 20 mm square frame (filament 1) round the 10 mm square that fills it (filament 2), 4 mm tall, as
# a Bambu Studio project of two objects that each name their filament, in the middle of the X2D's plate.
import zipfile

FRAME = [((0, 0, 0), (5, 20, 4)), ((15, 0, 0), (20, 20, 4)), ((5, 0, 0), (15, 5, 4)), ((5, 15, 0), (15, 20, 4))]
INSERT = [((5, 5, 0), (15, 15, 4))]
AT = 118


def mesh_xml(boxes):
    vertices, faces = [], []
    for lo, hi in boxes:
        for a, b, c in box(lo, hi):
            n = len(vertices)
            vertices += [a, b, c]
            faces.append((n, n + 1, n + 2))
    v = "".join(f'<vertex x="{x + AT}" y="{y + AT}" z="{z}"/>' for x, y, z in vertices)
    t = "".join(f'<triangle v1="{a}" v2="{b}" v3="{c}"/>' for a, b, c in faces)
    return f"<mesh><vertices>{v}</vertices><triangles>{t}</triangles></mesh>"


model = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
    f'<resources><object id="1" type="model">{mesh_xml(FRAME)}</object>'
    f'<object id="2" type="model">{mesh_xml(INSERT)}</object></resources>'
    '<build><item objectid="1"/><item objectid="2"/></build></model>\n'
)
settings = (
    '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n'
    '  <object id="1">\n    <metadata key="name" value="frame"/>\n    <metadata key="extruder" value="1"/>\n  </object>\n'
    '  <object id="2">\n    <metadata key="name" value="insert"/>\n    <metadata key="extruder" value="2"/>\n  </object>\n'
    "</config>\n"
)
with zipfile.ZipFile("two-colours.3mf", "w", zipfile.ZIP_DEFLATED) as z:
    for name, text in [
        ("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>\n'),
        ("3D/3dmodel.model", model),
        ("Metadata/model_settings.config", settings),
    ]:
        # A fixed date, so the file is the same each time.
        z.writestr(zipfile.ZipInfo(name, date_time=(2026, 11, 14, 0, 0, 0)), text, zipfile.ZIP_DEFLATED)
print("two-colours.3mf")
