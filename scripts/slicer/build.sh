#!/usr/bin/env bash
# =====================================================================================================================
# Builds Spaghetti's slicing engine from source: the Muon3D Slicer Engine (OrcaSlicer's libslic3r in WebAssembly,
# AGPL-3.0) at the commits pinned in scripts/slicer/pin.env, single-threaded only, with its worker host and the X2D's
# presets, packed as one zip for the app to serve (docs/slicer.md). The release workflow (.github/workflows/
# slicer-release.yml) runs it on a `slicer-v*` tag; it runs the same in a sandbox.
#
#   SLICER_VERSION=1 bash scripts/slicer/build.sh
#
# Environment:
#   SLICER_VERSION        the release's version (the tag without "slicer-v"); required
#   SLICER_WORK           where sources, the toolchain and build trees go (default .slicer-build, git-ignored)
#   SLICER_OUT            where the zip and SHA256SUMS go (default dist/slicer-release)
#   ORCA_WASM_ROOT        the engine's toolchain root (default $SLICER_WORK/toolchain): the emsdk, dependency
#                         sources and prefixes, build trees. Point it at an existing one to rebuild quickly.
#   SLICER_SYSTEM_TOOLS=1 use cmake (3.24 or newer) and ninja from PATH instead of downloading Kitware's x86-64 builds
#                         (for ARM machines); the emsdk is still installed
#   SLICER_ALLOW_DIFFERENT=1  go on when engine-st.wasm isn't byte for byte the engine's own release
#   BSDTAR                bsdtar (libarchive-tools), which the engine's dependency script extracts with
#   JOBS                  parallel compile jobs (default: all cores; each heavy C++ job can take 2 GB)
# =====================================================================================================================
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
# shellcheck source=pin.env
source "$HERE/pin.env"

VERSION=${SLICER_VERSION:?set SLICER_VERSION, e.g. SLICER_VERSION=1}
WORK=${SLICER_WORK:-$REPO/.slicer-build}
OUT=${SLICER_OUT:-$REPO/dist/slicer-release}
export ORCA_WASM_ROOT=${ORCA_WASM_ROOT:-$WORK/toolchain}
export JOBS=${JOBS:-$(nproc)}
ENGINE=$WORK/engine
mkdir -p "$WORK" "$OUT" "$ORCA_WASM_ROOT/tools/bin"
# The repository's package.json says "type": "module", so Node would read the plain .js programs Emscripten builds
# under this folder (the dependencies' smoke test) as modules, and they are CommonJS: the folder gets its own.
[[ -f $WORK/package.json ]] || echo '{ "private": true, "type": "commonjs" }' > "$WORK/package.json"

step() { echo "==== $(date -u +%H:%M:%S) $*"; }
fail() { echo "slicer build: $*" >&2; exit 1; }

step "engine $ENGINE_TAG ($ENGINE_COMMIT)"
if [[ ! -d $ENGINE/.git ]]; then
  git clone --quiet --depth 1 --branch "$ENGINE_TAG" "$ENGINE_REPO" "$ENGINE"
fi
[[ $(git -C "$ENGINE" rev-parse HEAD) == "$ENGINE_COMMIT" ]] || fail "$ENGINE is not at $ENGINE_COMMIT"
# A rebuild starts from the pinned sources: our one patch is applied again below.
git -C "$ENGINE" checkout --quiet -- host/src

step "OrcaSlicer $ORCA_COMMIT"
(cd "$ENGINE" && bash engine/scripts/get-orca.sh)
[[ $(git -C "$ENGINE/orca" rev-parse HEAD) == "$ORCA_COMMIT" ]] || fail "the engine's orca/ is not at $ORCA_COMMIT"

step "toolchain in $ORCA_WASM_ROOT"
if [[ ${SLICER_SYSTEM_TOOLS:-0} == 1 ]]; then
  # The engine's script installs Kitware's x86-64 CMake and Ninja; it keeps whatever is already in tools/.
  mkdir -p "$ORCA_WASM_ROOT/tools/cmake/bin"
  link_tool() {
    local from
    from=$(command -v "$1") || fail "$1 is not on PATH (SLICER_SYSTEM_TOOLS=1)"
    [[ $(readlink -f "$from") == "$(readlink -f "$2" 2> /dev/null)" ]] || ln -sf "$from" "$2"
  }
  link_tool cmake "$ORCA_WASM_ROOT/tools/cmake/bin/cmake"
  link_tool ninja "$ORCA_WASM_ROOT/tools/bin/ninja"
  if command -v ccache > /dev/null; then
    link_tool ccache "$ORCA_WASM_ROOT/tools/bin/ccache"
  elif [[ ! -e $ORCA_WASM_ROOT/tools/bin/ccache ]]; then
    # Only the engine's own CI uses ccache; its setup script just has to find one.
    printf '#!/bin/sh\necho "ccache (not installed)"\n' > "$ORCA_WASM_ROOT/tools/bin/ccache"
    chmod +x "$ORCA_WASM_ROOT/tools/bin/ccache"
  fi
fi
(cd "$ENGINE" && bash tools/ci/setup-toolchain.sh)
export PATH=$ORCA_WASM_ROOT/tools/cmake/bin:$ORCA_WASM_ROOT/tools/bin:$PATH

step "dependencies (single-threaded)"
(cd "$ENGINE" && bash engine/deps/fetch-deps.sh && VARIANT=st bash "$ENGINE/engine/deps/build-deps.sh")

step "engine (single-threaded)"
(cd "$ENGINE" && bash engine/scripts/build.sh st)
wasm_sha=$(sha256sum "$ENGINE/dist/engine-st.wasm" | cut -d' ' -f1)
mjs_sha=$(sha256sum "$ENGINE/dist/engine-st.mjs" | cut -d' ' -f1)
if [[ $wasm_sha != "$ENGINE_ST_WASM_SHA256" || $mjs_sha != "$ENGINE_ST_MJS_SHA256" ]]; then
  echo "engine-st.wasm $wasm_sha, engine-st.mjs $mjs_sha: not the engine's own release" \
    "($ENGINE_ST_WASM_SHA256, $ENGINE_ST_MJS_SHA256)" >&2
  [[ ${SLICER_ALLOW_DIFFERENT:-0} == 1 ]] || exit 1
else
  step "engine-st.wasm is byte for byte the engine's release ($wasm_sha)"
fi

step "host, with scripts/slicer/host.patch"
(cd "$ENGINE" && npm ci --no-audit --no-fund --loglevel=error && git apply "$HERE/host.patch" && npm run --silent build:host)

step "presets"
RUNTIME=$WORK/runtime
rm -rf "$RUNTIME" && mkdir -p "$RUNTIME"
node "$HERE/resolve-presets.mjs" "$ENGINE/dist" "$ENGINE/orca/resources/profiles" "$RUNTIME/presets.json"

step "pack"
node "$HERE/pack.mjs" "$ENGINE/dist" "$RUNTIME" "$OUT" "$VERSION"
step "done: $OUT"
