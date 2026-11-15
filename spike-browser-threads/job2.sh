#!/bin/bash
# job.sh <browser> <json without engines/modelFiles>  — engines and models are fixed here
B=$1; J=$2
cd /tmp/eng/bench
node -e '
const j=JSON.parse(process.argv[1]);
j.engines={st4:"/tmp/eng/v4/x", mt251:"/tmp/eng/mt251", st061:"/tmp/eng/e061", rs:"/tmp/rs-mt/target/wasm32-unknown-unknown/release", rsst:"/tmp/rs-st-target/wasm32-unknown-unknown/release"};
const M={benchy:["/tmp/models/benchy-placed.stl"],bunny:["/tmp/models/Stanford_Bunny.stl"],fdm:["/tmp/models/ksr_fdmtest_v4.stl"],four:[1,2,3,4].map(i=>`/tmp/models/four/b-${i}.stl`)};
j.modelFiles=M[j.model]||j.model; j.models=j.modelFiles; delete j.model;
require("fs").writeFileSync("/tmp/eng/bench/job.json",JSON.stringify(j));' "$J"
node drive2.mjs $B "$(cat job.json)"
