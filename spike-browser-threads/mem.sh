#!/bin/bash
cd /tmp/eng/bench; OUT=/tmp/eng/mem.jsonl; : > $OUT
run() { echo "# $*" >> $OUT; timeout 600 ./job2.sh "$@" 2>&1 | grep -v '"env"' | cut -c1-700 >> $OUT; }
for B in chromium webkit; do for rep in 1 2; do
 run $B '{"kind":"orca","engine":"st4","variant":"st","model":"benchy","runs":1,"coep":"none"}'
 run $B '{"kind":"orca","engine":"st4","variant":"st","model":"benchy","runs":1,"coep":"require-corp"}'
 run $B '{"kind":"orca","engine":"mt251","variant":"mt","threads":4,"model":"benchy","runs":1,"coep":"require-corp"}'
 run $B '{"kind":"orca","engine":"st4","variant":"st","model":"four","runs":1,"coep":"none"}'
 run $B '{"kind":"orca","engine":"mt251","variant":"mt","threads":4,"model":"four","runs":1,"coep":"require-corp"}'
 run $B '{"kind":"rs","engine":"rsst","wasm":"spaghetti_slicer.wasm","threads":0,"model":"four","runs":1,"coep":"none"}'
 run $B '{"kind":"rs","engine":"rs","wasm":"spaghetti_slicer.wasm","threads":4,"model":"four","runs":1,"coep":"require-corp"}'
done; done; echo DONE >> $OUT
