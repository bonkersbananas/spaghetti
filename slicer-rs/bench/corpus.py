"""Times the models people actually sliced: each folder capture.mts recorded (what the app handed the WebAssembly
module for one model, with its own settings), replayed natively on four threads and on one, in Node and in Chromium.
Prints each run as it goes and a table of medians, and checks that every runner wrote the same file.

  python3 -I bench/corpus.py <captures dir> [--runs 3] [--only rust-native,rust-wasm-node] [--models a,b]
    [--out results.json]

Native runs are pinned to 4 cores (taskset), as run.py's. Time is the slice alone for WebAssembly (the module loaded,
the calls' bytes read), start to exit for the command line. Memory: the command line's peak resident memory, the
WebAssembly heap at the end (it only grows, so its peak) and Node's peak resident memory, Chromium's processes' growth.
The models stay outside the repository: bench/corpus.json lists them (name, size, sha256, settings)."""

import argparse
import json
import os
import statistics
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CRATE = os.path.dirname(HERE)
BIN = os.environ.get("SLICER_BIN", os.path.join(CRATE, "target/release/spaghetti-slicer"))
WASM = os.environ.get("SLICER_WASM", os.path.join(CRATE, "target/wasm32-unknown-unknown/release/spaghetti_slicer.wasm"))
MEASURE = [sys.executable, "-I", os.path.join(HERE, "measure.py")]
CORES = ["taskset", "-c", "0-3"]
RUNNERS = ["rust-native", "rust-native-1t", "rust-wasm-node", "rust-wasm-chromium"]


def sha256(path):
    out = subprocess.run(["sha256sum", path], capture_output=True, text=True, check=True)
    return out.stdout.split()[0]


def measure(cmd, env=None):
    done = subprocess.run(MEASURE + cmd, capture_output=True, text=True, env={**os.environ, **(env or {})})
    return json.loads(done.stdout)


def native(capture, out, threads):
    m = measure(CORES + [BIN, "--replay", capture, "-o", out], {"RAYON_NUM_THREADS": str(threads)})
    if m["code"]:
        return {"error": m["stderr"][-300:]}
    return {"ms": m["wall_ms"], "peak_mb": m["peak_mb"], "sha256": sha256(out)}


def wasm_node(capture, out):
    m = measure(["node", "--max-old-space-size=6000", os.path.join(HERE, "wasm-node.mjs"), WASM, out, "--replay", capture])
    if m["code"]:
        return {"error": m["stdout"][-300:] + m["stderr"][-300:]}
    said = json.loads(m["stdout"].strip().splitlines()[-1])
    return {
        "ms": said["sliceMs"],
        "wasm_mb": said["wasmMemoryMB"],
        "peak_mb": m["peak_mb"],
        "timings": said["timings"],
        "sha256": sha256(out),
    }


def wasm_chromium(capture, runs):
    done = subprocess.run(
        ["node", os.path.join(HERE, "wasm-browser.mjs"), "chromium", os.path.dirname(WASM), str(runs), "--replay", capture],
        capture_output=True,
        text=True,
    )
    results = []
    for line in done.stdout.splitlines():
        said = json.loads(line)
        if "error" in said:
            results.append({"error": said["error"]})
            continue
        results.append(
            {
                "ms": said["sliceMs"],
                "wasm_mb": said["wasmMemoryMB"],
                "peak_mb": said["memory"]["peakExtraMB"],
                "timings": said["timings"],
                "sha256": said["sha256"],
            }
        )
    if not results:
        results.append({"error": done.stderr[-300:]})
    return results


def main():
    p = argparse.ArgumentParser()
    p.add_argument("captures")
    p.add_argument("--runs", type=int, default=3)
    p.add_argument("--only", default=",".join(RUNNERS))
    p.add_argument("--models", default="")
    p.add_argument("--out", default=os.path.join(HERE, "out/corpus.json"))
    a = p.parse_args()
    runners = a.only.split(",")
    models = a.models.split(",") if a.models else sorted(os.listdir(a.captures))
    os.makedirs(os.path.join(HERE, "out/corpus"), exist_ok=True)
    results = json.load(open(a.out)) if os.path.exists(a.out) else {}
    for model in models:
        capture = os.path.join(a.captures, model)
        if not os.path.exists(os.path.join(capture, "calls.json")):
            continue
        row = results.setdefault(model, {})
        for runner in runners:
            out = os.path.join(HERE, f"out/corpus/{model}.{runner}.gcode.3mf")
            if runner == "rust-wasm-chromium":
                runs = wasm_chromium(capture, a.runs)
            else:
                runs = []
                # Interleaved would be fairer across runners, but one model's runs together keep the sandbox's drift
                # within a model's row.
                for _ in range(a.runs):
                    if runner == "rust-native":
                        runs.append(native(capture, out, 4))
                    elif runner == "rust-native-1t":
                        runs.append(native(capture, out, 1))
                    else:
                        runs.append(wasm_node(capture, out))
            row[runner] = runs
            ok = [r for r in runs if "error" not in r]
            med = statistics.median(r["ms"] for r in ok) if ok else None
            print(
                f"{model} {runner}: "
                + (f"{med / 1000:.2f} s median of {len(ok)}" if ok else f"failed {runs[0].get('error')}")
                + "".join(f", {k} {max(r[k] for r in ok)} MB" for k in ("peak_mb", "wasm_mb") if ok and k in ok[0]),
                flush=True,
            )
        hashes = {r["sha256"] for runs in row.values() for r in runs if "sha256" in r}
        print(f"{model}: {'the same file from every runner' if len(hashes) == 1 else f'{len(hashes)} different files'}")
        json.dump(results, open(a.out, "w"), indent=1)


if __name__ == "__main__":
    main()
