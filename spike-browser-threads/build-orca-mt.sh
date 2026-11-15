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
#   SLICER_ALLOW_DIFFERENT=1  go on when engine-mt.wasm isn't byte for byte the engine's own release
#   BSDTAR                bsdtar (libarchive-tools), which the engine's dependency script extracts with
#   JOBS                  parallel compile jobs (default: all cores; each heavy C++ job can take 2 GB)
# =====================================================================================================================
set -euo pipefail

HERE=/home/agent/workspace/scripts/slicer
REPO=/home/agent/workspace
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
# A rebuild starts from the pinned sources: our patches are applied again below.
git -C "$ENGINE" checkout --quiet -- . && git -C "$ENGINE" clean --quiet -fd -- engine host

step "OrcaSlicer $ORCA_VERSION ($ORCA_COMMIT)"
# Upstream's release, in the engine's orca/ (its own is the Muon3D fork's 2.5.0-dev): a plain checkout of the tag.
if [[ ! -d $ENGINE/orca/.git ]]; then
  rm -rf "$ENGINE/orca" && git init --quiet "$ENGINE/orca"
fi
if [[ $(git -C "$ENGINE/orca" rev-parse HEAD 2> /dev/null || true) != "$ORCA_COMMIT" ]]; then
  git -C "$ENGINE/orca" fetch --quiet --depth 1 "$ORCA_REPO" "refs/tags/$ORCA_TAG"
  git -C "$ENGINE/orca" checkout --quiet --force FETCH_HEAD
fi
[[ $(git -C "$ENGINE/orca" rev-parse HEAD) == "$ORCA_COMMIT" ]] || fail "the engine's orca/ is not at $ORCA_COMMIT ($ORCA_TAG)"
# What the engine needs to build against it: dependencies (CGAL 6.2.1, expat 2.10.0), sources that moved, and
# the shims for what Orca 2.5.1 uses of TBB, OCCT and Boost.Interval that the engine's own tree has no stand-in for.
git -C "$ENGINE" apply "$HERE/engine.patch"

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

step "dependencies (multithreaded)"
(cd "$ENGINE" && bash engine/deps/fetch-deps.sh && VARIANT=mt bash "$ENGINE/engine/deps/build-deps.sh")

step "engine (multithreaded)"
(cd "$ENGINE" && bash engine/scripts/build.sh mt)
ls -la "$ENGINE"/dist/
