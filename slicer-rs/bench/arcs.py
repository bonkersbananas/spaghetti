"""Extrusions per feature in G-code files, side by side: lines (`G1` with X or Y and E > 0), arcs (`G2`/`G3`) and the
plastic (mm of filament) in each, as the arcs subsection of docs/proposals/rust-slicer.md counts them.

    python3 -I bench/arcs.py orca.gcode ours.gcode [more.gcode ...]"""
import sys, re, collections
def scan(path):
    feat = "start"; out = collections.defaultdict(lambda: [0, 0, 0.0, 0.0])
    for line in open(path, errors="replace"):
        if line.startswith("; FEATURE: "):
            feat = line[11:].strip(); continue
        if line[0] != "G": continue
        g = line[:3]
        if g not in ("G1 ", "G2 ", "G3 "): continue
        code = line.split(";")[0]
        if " X" not in code and " Y" not in code: continue
        m = re.search(r" E(-?[\d.]+)", code)
        if not m: continue
        e = float(m.group(1))
        if e <= 0: continue
        r = out[feat]
        if g == "G1 ": r[0] += 1; r[2] += e
        else: r[1] += 1; r[3] += e
    return out
files = sys.argv[1:]
data = [scan(f) for f in files]
feats = sorted(set().union(*[d.keys() for d in data]), key=lambda f: -sum(d[f][0] + d[f][1] for d in data if f in d))
print("feature".ljust(26) + "".join(f"{'lines':>9}{'arcs':>8}{'E':>10}" for _ in files))
tot = [[0,0,0.0] for _ in files]
for f in feats:
    row = f[:25].ljust(26)
    for i, d in enumerate(data):
        r = d.get(f, [0,0,0,0]); row += f"{r[0]:9d}{r[1]:8d}{r[2]+r[3]:10.2f}"
        tot[i][0] += r[0]; tot[i][1] += r[1]; tot[i][2] += r[2] + r[3]
    print(row)
print("total".ljust(26) + "".join(f"{t[0]:9d}{t[1]:8d}{t[2]:10.2f}" for t in tot))
