"""Diffs the head and the tail of two G-code files line by line: ours and native OrcaSlicer's for the same models in
the same place (`spaghetti-slicer --keep-placement` and `orca-slicer --arrange 0`).

    python3 -I headtail.py <ours.gcode> <orca.gcode>

The head is everything before the first layer's first printed path (header, settings, the printer's start G-code,
the first layer change and the travel down to the first path). The tail is everything after the last printed move
(the last retraction and lift, the last timelapse photo, the printer's end G-code and the totals). The settings
block (`; CONFIG_BLOCK_START` to `; CONFIG_BLOCK_END`) is compared by key: Orca lists every setting it has, we list
ours. Prints each part's differences, and how many lines differ."""

import difflib
import re
import sys

EXTRUDE = re.compile(r"^G[123] .*[XY]-?[\d.].*E[\d.]")


def parts(path):
    lines = open(path, encoding="utf-8", errors="replace").read().split("\n")
    start = lines.index("; CONFIG_BLOCK_START")
    end = lines.index("; CONFIG_BLOCK_END")
    config = {}
    for line in lines[start + 1 : end]:
        key, _, value = line[2:].partition(" = ")
        config[key] = value
    first_layer = lines.index("; CHANGE_LAYER")
    first_path = next(i for i in range(first_layer, len(lines)) if lines[i].startswith("; FEATURE:"))
    last_move = max(i for i, line in enumerate(lines) if EXTRUDE.match(line))
    return {
        "header": lines[:start],
        "config": config,
        "head": lines[end + 1 : first_path],
        "tail": lines[last_move + 1 :],
    }


def show(name, ours, orca):
    diff = list(difflib.unified_diff(orca, ours, "orca", "ours", lineterm="", n=1))
    changed = sum(1 for line in diff if line[:1] in "+-" and not line.startswith(("+++", "---")))
    print(f"== {name}: {len(orca)} lines in Orca's, {len(ours)} in ours, {changed} lines differ")
    for line in diff[2:]:
        print(line)
    print()


def main():
    ours, orca = parts(sys.argv[1]), parts(sys.argv[2])
    show("header", ours["header"], orca["header"])
    a, b = ours["config"], orca["config"]
    only_orca = sorted(set(b) - set(a))
    only_ours = sorted(set(a) - set(b))
    differ = sorted(k for k in set(a) & set(b) if a[k] != b[k])
    print(f"== settings block: {len(b)} settings in Orca's, {len(a)} in ours; {len(only_orca)} only in Orca's, "
          f"{len(only_ours)} only in ours, {len(differ)} with other values")
    for k in only_ours:
        print(f"  only ours: {k} = {a[k][:100]}")
    for k in differ:
        print(f"  {k}: Orca {b[k][:60]!r}, ours {a[k][:60]!r}")
    print()
    show("head (after the settings block, to the first printed path)", ours["head"], orca["head"])
    show("tail (after the last printed move)", ours["tail"], orca["tail"])


if __name__ == "__main__":
    main()
