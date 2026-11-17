#!/bin/bash
# run_orca.sh <bench case dir> <out dir>: native Orca on a case of bench/supports.py (its orca/ presets and plate), on one
# core, with hook.so (gcc -O1 -shared -fPIC -o hook.so hook.c -ldl -lpthread) logging HOOK_ADDRS ("<hex vaddr>:<kind>,...",
# see hook.c) to <out dir>/hook.out. ORCA_NATIVE is the folder holding the extracted AppImage's squashfs-root.
case=$(realpath "$1"); out=$(realpath -m "$2"); mkdir -p "$out"
hook=${HOOK_SO:-$(dirname "$(realpath "$0")")/hook.so}
root=${ORCA_NATIVE:-/home/agent/orca}/squashfs-root
cd "$case" && taskset -c 0 env HOOK_OUT="$out/hook.out" HOOK_ADDRS="${HOOK_ADDRS:-2c3a040:1}" LD_PRELOAD="$hook" \
  XDG_RUNTIME_DIR=/tmp LD_LIBRARY_PATH="$root/lib:$root/usr/lib" "$root/bin/orca-slicer" --arrange 0 \
  --load-settings "orca/machine.json;orca/process.json" --load-filaments orca/filament-1.json --slice 0 \
  --outputdir "$out" orca/plate.3mf > "$out/log.txt" 2>&1
echo "exit $?"
