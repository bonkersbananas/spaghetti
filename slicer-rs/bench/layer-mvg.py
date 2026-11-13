"""Draws one layer of a G-code file (Orca's or this slicer's), coloured by feature, line widths to scale, as an
ImageMagick drawing (MVG): python3 layer-mvg.py <file.gcode> <layer number, from 1> <out.mvg> [minx miny maxx maxy],
then `convert mvg:out.mvg out.png`. Arcs (G2/G3, which Orca fits to curves) are drawn as arcs."""

import math
import sys

COLOURS = {
    "Inner wall": "#E8C547",
    "Outer wall": "#F2754E",
    "Overhang wall": "#3B5BDB",
    "Sparse infill": "#9C2B2B",
    "Internal solid infill": "#8B5CC6",
    "Top surface": "#E03131",
    "Bottom surface": "#4C9AFF",
    "Bridge": "#3C6E9E",
    "Internal Bridge": "#74C0FC",
    "Gap infill": "#2F9E44",
}


def main():
    path, wanted, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    box = [float(v) for v in sys.argv[4:8]] if len(sys.argv) >= 8 else None
    layer = 0
    feature = "Other"
    width = 0.45
    x = y = 0.0
    segments = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("; CHANGE_LAYER"):
                layer += 1
                if layer > wanted:
                    break
                continue
            if line.startswith("; FEATURE:"):
                feature = line[10:].strip()
                continue
            if line.startswith("; LINE_WIDTH:"):
                width = float(line[13:])
                continue
            if not (line.startswith("G1 ") or line.startswith("G2 ") or line.startswith("G3 ")):
                continue
            words = line.split(";")[0].split()
            nx, ny, e, ci, cj = x, y, 0.0, 0.0, 0.0
            for w in words[1:]:
                if w[0] == "X":
                    nx = float(w[1:])
                elif w[0] == "Y":
                    ny = float(w[1:])
                elif w[0] == "E":
                    e = float(w[1:])
                elif w[0] == "I":
                    ci = float(w[1:])
                elif w[0] == "J":
                    cj = float(w[1:])
            if layer == wanted and e > 0 and (nx != x or ny != y):
                points = [(x, y), (nx, ny)]
                if line[1] in "23" and (ci or cj):
                    # An arc about (x + I, y + J): clockwise for G2, counter-clockwise for G3, in steps of 5°.
                    cx, cy = x + ci, y + cj
                    a0, a1 = math.atan2(y - cy, x - cx), math.atan2(ny - cy, nx - cx)
                    sweep = (a1 - a0) % (2 * math.pi)
                    if line[1] == "2":
                        sweep -= 2 * math.pi
                    r = math.hypot(x - cx, y - cy)
                    n = max(2, int(abs(sweep) / math.radians(5)) + 1)
                    points = [(cx + r * math.cos(a0 + sweep * k / n), cy + r * math.sin(a0 + sweep * k / n)) for k in range(n)]
                    points.append((nx, ny))
                for (ax, ay), (bx, by) in zip(points, points[1:]):
                    segments.append((ax, ay, bx, by, feature, width))
            x, y = nx, ny
    if not segments:
        sys.exit(f"no extrusions on layer {wanted}")
    if box is None:
        xs = [s[0] for s in segments] + [s[2] for s in segments]
        ys = [s[1] for s in segments] + [s[3] for s in segments]
        box = [min(xs) - 1, min(ys) - 1, max(xs) + 1, max(ys) + 1]
    minx, miny, maxx, maxy = box
    scale = 1000 / max(maxx - minx, maxy - miny)
    w, h = (maxx - minx) * scale, (maxy - miny) * scale
    parts = [f"viewbox 0 0 {w:.0f} {h:.0f}", "fill #1b1b1f", f"rectangle 0,0 {w:.0f},{h:.0f}", "fill none"]
    parts.append("stroke-linecap round")
    parts.append("stroke-opacity 0.85")
    for x0, y0, x1, y1, feat, wd in segments:
        colour = COLOURS.get(feat, "#aaaaaa")
        parts.append(f"stroke {colour}")
        parts.append(f"stroke-width {wd * scale:.2f}")
        parts.append(
            f"line {(x0 - minx) * scale:.2f},{(maxy - y0) * scale:.2f} {(x1 - minx) * scale:.2f},{(maxy - y1) * scale:.2f}"
        )
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(parts) + "\n")
    print(f"{len(segments)} segments; box {minx:.1f} {miny:.1f} {maxx:.1f} {maxy:.1f}")


main()
