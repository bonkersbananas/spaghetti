"""Pre-flight read of a G-code file for the X2D, and its comparison with native Orca's for the same plate:
docs/proposals/first-print-preflight.md says what each line checks and why.

    python3 -I preflight.py <ours.gcode> [<orca.gcode>]

For each file: where it extrudes (bounding box), the highest volumetric flow, the fastest extrusion per filament,
whether any move goes below its layer's Z, and the highest nozzle, bed and flush temperatures. With both files: the
printer's control lines (every line that is not a G0-G3 move, comments and M73 left out) in order, and how they differ
once the lines that legitimately move around (M204, G17, M624/M625) are left out. Nothing here is sent to a printer."""

import difflib
import math
import re
import sys

MOVE = re.compile(r"G([0123])\b(.*)")
WORD = re.compile(r"[XYZEFIJP]-?[\d.]+$")
QUIET = re.compile(r"^(M204|G17|M624|M625)\b")


def words(rest):
    return {w[0]: float(w[1:]) for w in rest.split() if WORD.match(w)}


def read(path):
    return open(path, encoding="utf-8", errors="replace").read().split("\n")


def audit(path):
    body = False
    x = y = f = None
    box = [1e9, 1e9, -1e9, -1e9]
    flow = 0.0
    speed = {}
    tool = None
    layer_z = None
    below = 0
    temps = {}
    for line in read(path):
        if "MACHINE_START_GCODE_END" in line:
            body = True
        if "MACHINE_END_GCODE_START" in line:
            body = False
        if line.startswith("; Z_HEIGHT:"):
            layer_z = float(line.split(":")[1])
        code = line.split(";")[0].strip()
        t = re.match(r"T(\d+) H", code)
        if t:
            tool = t.group(1)
        for pat, key in (
            (r"M10[49] .*?S(\d+)", "nozzle"),
            (r"M(?:140|190) S(\d+)", "bed"),
            (r"M620\.10 .*?T(\d+)", "flush"),
        ):
            m = re.match(pat, code)
            if m:
                temps[key] = max(temps.get(key, 0), int(m.group(1)))
        m = MOVE.match(code)
        if not m or not body:
            continue
        a = words(m.group(2))
        f = a.get("F", f)
        nx, ny = a.get("X", x), a.get("Y", y)
        if "Z" in a and layer_z is not None and a["Z"] < layer_z - 1e-6:
            below += 1
        if a.get("E", 0) > 0 and ("X" in a or "Y" in a) and x is not None and y is not None and f:
            if m.group(1) == "1":
                length = math.hypot(nx - x, ny - y)
            else:
                i, j = a.get("I", 0), a.get("J", 0)
                cx, cy = x + i, y + j
                d = math.atan2(ny - cy, nx - cx) - math.atan2(y - cy, x - cx)
                d = d % (2 * math.pi) if m.group(1) == "3" else -((-d) % (2 * math.pi))
                if abs(d) < 1e-9:
                    d = 2 * math.pi  # the end is the start: a full circle
                length = abs(d) * math.hypot(i, j)
            if length > 0.05:
                flow = max(flow, a["E"] * 2.405 / (length / (f / 60)))
            speed[tool] = max(speed.get(tool, 0), f / 60)
            for px, py in ((x, y), (nx, ny)):
                box = [min(box[0], px), min(box[1], py), max(box[2], px), max(box[3], py)]
        x, y = nx, ny
    return {
        "extrusion box": [round(v, 2) for v in box],
        "max flow mm3/s": round(flow, 2),
        "max extrusion mm/s by filament": {k: round(v) for k, v in speed.items()},
        "moves below their layer": below,
        "max temperatures": temps,
    }


def control(path):
    out = []
    for line in read(path):
        code = line.split(";")[0].strip()
        if code and not code.startswith("M73") and not MOVE.match(code):
            out.append(code)
    return out


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    for p in sys.argv[1:3]:
        print(p)
        for k, v in audit(p).items():
            print(f"  {k}: {v}")
    if len(sys.argv) > 2:
        a = [c for c in control(sys.argv[2]) if not QUIET.match(c)]
        b = [c for c in control(sys.argv[1]) if not QUIET.match(c)]
        diff = [d for d in difflib.unified_diff(a, b, "orca", "ours", lineterm="", n=0) if not d.startswith("@@")]
        print(f"control lines: {len(a)} in Orca's, {len(b)} in ours, {len(diff) - 2 if diff else 0} differ")
        print("\n".join(diff[:60]))


main()
