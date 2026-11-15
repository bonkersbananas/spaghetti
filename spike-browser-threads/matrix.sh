#!/bin/bash
cd /tmp/eng/bench; OUT=/tmp/eng/results.jsonl
run() { echo "# $*" >> $OUT; timeout 900 ./job.sh "$@" 2>&1 | grep -v '"env"' | cut -c1-900 >> $OUT; }
for B in chromium webkit; do
 for M in benchy bunny fdm four; do
  R=2; [ $M = four ] && R=1
  run $B "{\"kind\":\"orca\",\"engine\":\"st4\",\"variant\":\"st\",\"model\":\"$M\",\"runs\":$R,\"coep\":\"none\"}"
  for T in 2 4; do run $B "{\"kind\":\"orca\",\"engine\":\"mt251\",\"variant\":\"mt\",\"threads\":$T,\"model\":\"$M\",\"runs\":$R,\"coep\":\"require-corp\"}"; done
 done
 for M in benchy bunny fdm four; do
  run $B "{\"kind\":\"rs\",\"engine\":\"rsst\",\"wasm\":\"spaghetti_slicer.wasm\",\"threads\":0,\"model\":\"$M\",\"runs\":3,\"coep\":\"none\"}"
  for T in 1 2 4; do run $B "{\"kind\":\"rs\",\"engine\":\"rs\",\"wasm\":\"spaghetti_slicer.wasm\",\"threads\":$T,\"model\":\"$M\",\"runs\":3,\"coep\":\"require-corp\"}"; done
 done
done
echo DONE >> $OUT
