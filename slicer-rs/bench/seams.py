"""Where the outer walls start, against Orca's: python3 -I seams.py orca.gcode rust.gcode [--mirror-y Y] [--list]

For each outer wall loop in Orca's G-code, the outer wall loop on the same layer of the other G-code that passes
nearest its start, and where that one starts: within 0.5 mm of Orca's start ("same"), within 0.5 mm of its mirror
image across y = Y ("mirror": a symmetric model's other side, 128 by default, the middle of the X2D's plate), within
2 mm ("near") or further ("elsewhere"). A loop starts in a corner where it turns by more than 30 degrees over half a
millimetre either side of its start. Arcs (G2/G3) are followed in 5 degree steps."""

import collections
import math
import sys

WALLS = ("Outer wall", "Inner wall", "Overhang wall")


def arc(x, y, nx, ny, i, j, clockwise):
    cx, cy = x + i, y + j
    r = math.hypot(i, j)
    a0, a1 = math.atan2(y - cy, x - cx), math.atan2(ny - cy, nx - cx)
    if clockwise:
        while a1 >= a0:
            a1 -= 2 * math.pi
    else:
        while a1 <= a0:
            a1 += 2 * math.pi
    n = max(1, int(abs(a1 - a0) / math.radians(5)))
    steps = [(cx + r * math.cos(a0 + (a1 - a0) * k / n), cy + r * math.sin(a0 + (a1 - a0) * k / n)) for k in range(1, n)]
    return steps + [(nx, ny)]


def loops(path):
    """Each layer's wall loops as printed: their points, and whether they are outer walls."""
    out = collections.defaultdict(list)
    layer, feature, x, y, current = 0, None, 0.0, 0.0, None
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("; CHANGE_LAYER"):
                layer += 1
                current = None
                continue
            if line.startswith("; FEATURE:"):
                feature = line.split(":", 1)[1].strip()
                if feature not in WALLS:
                    current = None
                continue
            if not line.startswith(("G0", "G1", "G2", "G3")):
                continue
            words = line.split(";")[0].split()
            v = {w[0]: float(w[1:]) for w in words[1:] if w[0] in "XYEIJ" and len(w) > 1}
            nx, ny, e = v.get("X", x), v.get("Y", y), v.get("E")
            if (nx, ny) != (x, y) or words[0] in ("G2", "G3"):
                if e is not None and e > 0 and feature in WALLS:
                    if current is None:
                        current = {"points": [(x, y)], "outer": False}
                        out[layer].append(current)
                    if words[0] in ("G2", "G3"):
                        current["points"] += arc(x, y, nx, ny, v.get("I", 0.0), v.get("J", 0.0), words[0] == "G2")
                    else:
                        current["points"].append((nx, ny))
                    current["outer"] |= feature == "Outer wall"
                elif e is None or e <= 0:
                    current = None
            x, y = nx, ny
    return out


def to_segment(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)


def to_loop(p, loop):
    pts = loop["points"]
    return min(to_segment(p, pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def turn(points):
    """Degrees the loop turns at its start, from half a millimetre before it to half a millimetre after."""
    start = points[0]

    def along(seq):
        walked, prev = 0.0, seq[0]
        for q in seq[1:]:
            walked += math.dist(prev, q)
            prev = q
            if walked >= 0.5:
                return q
        return prev

    after, before = along(points), along([start] + points[::-1])
    a = (start[0] - before[0], start[1] - before[1])
    b = (after[0] - start[0], after[1] - start[1])
    na, nb = math.hypot(*a), math.hypot(*b)
    if na == 0 or nb == 0:
        return 0.0
    return math.degrees(math.acos(max(-1.0, min(1.0, (a[0] * b[0] + a[1] * b[1]) / (na * nb)))))


def main():
    args = sys.argv[1:]
    mirror_y = float(args[args.index("--mirror-y") + 1]) if "--mirror-y" in args else 128.0
    orca, ours = loops(args[0]), loops(args[1])
    kinds, corners, far = collections.Counter(), collections.Counter(), []
    for layer, theirs in sorted(orca.items()):
        mine = [m for m in ours.get(layer, []) if m["outer"]]
        for loop in theirs:
            if not loop["outer"] or len(loop["points"]) < 3 or not mine:
                continue
            start = loop["points"][0]
            other = min(mine, key=lambda m: to_loop(start, m))["points"][0]
            d = math.dist(start, other)
            if d < 0.5:
                kind = "same"
            elif math.dist((start[0], 2 * mirror_y - start[1]), other) < 0.5:
                kind = "mirror"
            elif d < 2:
                kind = "near"
            else:
                kind = "elsewhere"
            kinds[kind] += 1
            if turn(loop["points"]) > 30:
                corners[kind] += 1
            if kind == "elsewhere":
                far.append((layer, start, other, d))
    n, c = sum(kinds.values()), sum(corners.values())
    names = ("same", "mirror", "near", "elsewhere")
    print(
        f"{n} outer loops: "
        + ", ".join(f"{k} {kinds[k] / max(1, n) * 100:.0f} %" for k in names)
        + f" | {c} start in a corner: "
        + ", ".join(f"{k} {corners[k] / max(1, c) * 100:.0f} %" for k in names)
    )
    if "--list" in args:
        for layer, start, other, d in far:
            print(f"layer {layer}: Orca's at {start[0]:.2f},{start[1]:.2f}, ours at {other[0]:.2f},{other[1]:.2f} ({d:.2f} mm)")


main()
