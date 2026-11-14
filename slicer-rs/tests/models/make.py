"""Writes the test models: python3 -I make.py (from this folder). bridge.stl: two 10 mm pillars 20 mm apart under
a 3 mm beam, as three touching boxes, for walls, infill, top and bottom surfaces and a bridge. two-colours.3mf: a
frame and the square that fills it, in two filaments. parts.3mf: one object of three parts in two filaments that cut
into each other. t-parts.3mf: a T of three parts in two filaments, whose bar needs supports. tees.3mf: three Ts, each
in a filament of its own, whose supports take the flushes of the two that share a nozzle."""

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


def mesh_xml(boxes, at=AT):
    vertices, faces = [], []
    for lo, hi in boxes:
        for a, b, c in box(lo, hi):
            n = len(vertices)
            vertices += [a, b, c]
            faces.append((n, n + 1, n + 2))
    v = "".join(f'<vertex x="{x + at}" y="{y + at}" z="{z}"/>' for x, y, z in vertices)
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

# parts.3mf: one object, a Bambu Studio project, of three parts: a 20 mm slab 4 mm thick (filament 1), a post over its
# right edge 10 mm tall (filament 2), which cuts into the slab, and a nub sunk into the slab's top (filament 1), which
# merges with it.
PARTS = [("slab", 1, [((0, 0, 0), (20, 20, 4))]), ("post", 2, [((15, 7, 0), (23, 13, 10))]), ("nub", 1, [((4, 4, 2), (8, 8, 6))])]
resources = "".join(f'<object id="{k + 1}" type="model">{mesh_xml(boxes)}</object>' for k, (_, _, boxes) in enumerate(PARTS))
whole = len(PARTS) + 1
components = "".join(f'<component objectid="{k + 1}"/>' for k in range(len(PARTS)))
model = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
    f'<resources>{resources}<object id="{whole}" type="model"><components>{components}</components></object></resources>'
    f'<build><item objectid="{whole}"/></build></model>\n'
)
parts = "".join(
    f'    <part id="{k + 1}" subtype="normal_part">\n      <metadata key="name" value="{name}"/>\n'
    f'      <metadata key="extruder" value="{extruder}"/>\n    </part>\n'
    for k, (name, extruder, _) in enumerate(PARTS)
)
settings = (
    '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n'
    f'  <object id="{whole}">\n    <metadata key="name" value="slab and post"/>\n'
    f'    <metadata key="extruder" value="1"/>\n{parts}  </object>\n</config>\n'
)
with zipfile.ZipFile("parts.3mf", "w", zipfile.ZIP_DEFLATED) as z:
    for name, text in [
        ("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>\n'),
        ("3D/3dmodel.model", model),
        ("Metadata/model_settings.config", settings),
    ]:
        z.writestr(zipfile.ZipInfo(name, date_time=(2026, 11, 14, 0, 0, 0)), text, zipfile.ZIP_DEFLATED)
print("parts.3mf")


def project(path, objects):
    """A Bambu Studio project of `objects`, each a name and its parts: (name, filament, boxes) on the plate as they
    are."""
    resources, items, configs, k = "", "", "", 0
    for name, parts in objects:
        ids = []
        for _, _, boxes in parts:
            k += 1
            ids.append(k)
            resources += f'<object id="{k}" type="model">{mesh_xml(boxes, 0)}</object>'
        k += 1
        components = "".join(f'<component objectid="{i}"/>' for i in ids)
        resources += f'<object id="{k}" type="model"><components>{components}</components></object>'
        items += f'<item objectid="{k}"/>'
        config = "".join(
            f'    <part id="{i}" subtype="normal_part">\n      <metadata key="name" value="{part}"/>\n'
            f'      <metadata key="extruder" value="{extruder}"/>\n    </part>\n'
            for i, (part, extruder, _) in zip(ids, parts)
        )
        configs += (
            f'  <object id="{k}">\n    <metadata key="name" value="{name}"/>\n'
            f'    <metadata key="extruder" value="{parts[0][1]}"/>\n{config}  </object>\n'
        )
    model = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
        f"<resources>{resources}</resources><build>{items}</build></model>\n"
    )
    settings = f'<?xml version="1.0" encoding="UTF-8"?>\n<config>\n{configs}</config>\n'
    # With the package's relationships, which Orca's command line needs to read it.
    rels = (
        '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>'
        "</Relationships>\n"
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, text in [
            ("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>\n'),
            ("_rels/.rels", rels),
            ("3D/3dmodel.model", model),
            ("Metadata/model_settings.config", settings),
        ]:
            z.writestr(zipfile.ZipInfo(name, date_time=(2026, 11, 14, 0, 0, 0)), text, zipfile.ZIP_DEFLATED)
    print(path)


# t-parts.3mf: a T 44 mm wide, 12 deep and 25 tall in the middle of the plate, its column's left half in filament 1,
# its right half in filament 2 and its bar in filament 1, so its supports stand under the bar's arms on layers that
# print both filaments.
project("t-parts.3mf", [("T", [
    ("left", 1, [((122, 122, 0), (128, 134, 20))]),
    ("right", 2, [((128, 122, 0), (134, 134, 20))]),
    ("bar", 1, [((106, 122, 20), (150, 134, 25))]),
])])


# tees.3mf: three Ts 40 mm wide, 10 deep and 25 tall, in filaments 1, 2 and 3: the X2D's two nozzles print three
# filaments, so two of them share one, and each layer flushes once, into the supports first.
def tee(x, y):
    return [((x + 15, y, 0), (x + 25, y + 10, 20)), ((x, y, 20), (x + 40, y + 10, 25))]


project("tees.3mf", [(f"tee {k + 1}", [(f"tee {k + 1}", k + 1, tee(x, y))]) for k, (x, y) in enumerate([(60, 123), (140, 123), (100, 83)])])
