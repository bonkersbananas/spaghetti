#!/bin/sh
# Spaghetti's printer bridge, for a Mac. Run from the Printer page in Spaghetti:
#
#   curl -fsSL https://spaghetti.day/bridge/install.sh | sh -s -- ABCD-EFGH
#
# It downloads the bridge program from the project's GitHub releases, checks its checksum, puts it in
# ~/Library/Application Support/Spaghetti Bridge, and hands over to `spaghetti-bridge setup`, which pairs with
# Spaghetti (the code is single use and expires), asks for what it doesn't know, and installs a login item.
# Run it again to update. To remove everything:
#
#   curl -fsSL https://spaghetti.day/bridge/install.sh | sh -s -- uninstall
#
# Read it before you run it: it is about 150 lines, in public/bridge/install.sh of the repository. It never asks
# for a password, never uses sudo and only touches your own Library folders.
#
# Options (after the code): --app URL (a Spaghetti that isn't spaghetti.day), --version TAG, and the ones
# `spaghetti-bridge setup` takes: --ip, --serial, --access-code, --camera off, --no-check, --no-start.

REPO="bonkersbananas/spaghetti"
# These names are the same as in bridge/mac/paths.ts; test/bridge/installer.test.ts keeps them in step.
LABEL="day.spaghetti.bridge"
APP_NAME="Spaghetti Bridge"

say() { printf '%s\n' "$*"; }
fail() {
  printf '✗ %s\n' "$*" >&2
  exit 1
}

# asset_for OS ARCH TRANSLATED: the release file for this machine, or nothing.
asset_for() {
  [ "$1" = "Darwin" ] || return 1
  case "$2" in
    arm64) echo "darwin-arm64" ;;
    # A shell running under Rosetta says x86_64 on an Apple silicon Mac; the program should be the native one.
    x86_64) if [ "$3" = "1" ]; then echo "darwin-arm64"; else echo "darwin-x64"; fi ;;
    *) return 1 ;;
  esac
}

# latest_tag: reads GitHub's list of the repository's bridge-v… tags (git/matching-refs/tags/bridge-v, one request, and
# slicer releases can't push it off a page) on stdin and prints the highest plain x.y.z one: by number, so
# bridge-v0.1.10 beats bridge-v0.1.9. Pre-release tags (bridge-v1.0.0-rc.1) are left out.
latest_tag() {
  grep -o '"ref": *"refs/tags/bridge-v[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*"' |
    sed 's/.*refs\/tags\/\(bridge-v[^"]*\)"$/\1/' |
    awk '{ v = substr($0, 9); split(v, p, "."); k = p[1] * 1000000000000 + p[2] * 1000000 + p[3]; if (k > best) { best = k; tag = $0 } }
      END { if (tag != "") print tag }'
}

# sha256 FILE: its SHA-256, with whichever tool this system has.
sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    return 1
  fi
}

# checksum_ok FILE SUMS NAME: whether SUMS (lines of "<sha256>  <name>") lists FILE's checksum under NAME.
checksum_ok() {
  wanted=$(grep "  $3\$" "$2" | head -n 1 | cut -d ' ' -f 1)
  [ -n "$wanted" ] || return 1
  actual=$(sha256 "$1") || return 1
  [ "$wanted" = "$actual" ]
}

uninstall() {
  uid=$(id -u)
  support="$HOME/Library/Application Support/$APP_NAME"
  if [ -x "$support/bin/spaghetti-bridge" ]; then
    exec "$support/bin/spaghetti-bridge" uninstall
  fi
  # The program is gone or broken: do what it would have done.
  launchctl bootout "gui/$uid/$LABEL" >/dev/null 2>&1
  rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
  rm -rf "$support" "$HOME/Library/Logs/$APP_NAME"
  say "The Spaghetti bridge is stopped and removed."
  say "In Spaghetti, open the Printer page and press Disconnect, so its token is ended too."
  exit 0
}

main() {
  [ "$(uname -s)" = "Darwin" ] || fail "This installer is for a Mac. For a Raspberry Pi, a NAS or Docker, see docs/bridge.md in the repository."
  [ "$(id -u)" != "0" ] || fail "Run it as yourself, not with sudo: the bridge belongs to your login."

  if [ "$1" = "uninstall" ]; then uninstall; fi

  # --version TAG is ours; everything else goes on to `setup` (the arguments are rotated, so quoting is kept).
  tag="${SPAGHETTI_BRIDGE_VERSION:-}"
  left=$#
  while [ "$left" -gt 0 ]; do
    arg="$1"
    shift
    left=$((left - 1))
    if [ "$arg" = "--version" ] && [ "$left" -gt 0 ]; then
      tag="$1"
      shift
      left=$((left - 1))
    else
      set -- "$@" "$arg"
    fi
  done

  translated=$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)
  asset=$(asset_for "$(uname -s)" "$(uname -m)" "$translated") || fail "This Mac's processor ($(uname -m)) isn't supported."
  command -v curl >/dev/null 2>&1 || fail "curl is missing."
  work=$(mktemp -d "${TMPDIR:-/tmp}/spaghetti-bridge.XXXXXX") || fail "Couldn't make a temporary folder."
  trap 'rm -rf "$work"' EXIT

  if [ -z "$tag" ]; then
    say "Looking for the latest bridge…"
    curl -fsSL "https://api.github.com/repos/$REPO/git/matching-refs/tags/bridge-v" -o "$work/tags.json" || fail "Couldn't reach GitHub. Are you online?"
    tag=$(latest_tag <"$work/tags.json")
    [ -n "$tag" ] || fail "No bridge release was found yet."
  fi
  version="${tag#bridge-v}"
  name="spaghetti-bridge-$asset.gz"
  base="https://github.com/$REPO/releases/download/$tag"

  say "Downloading the Spaghetti bridge $version for $asset…"
  curl -fSL --progress-bar "$base/$name" -o "$work/$name" || fail "Couldn't download $name from $base."
  curl -fsSL "$base/SHA256SUMS" -o "$work/SHA256SUMS" || fail "Couldn't download the checksums."
  checksum_ok "$work/$name" "$work/SHA256SUMS" "$name" || fail "The download doesn't match its checksum, so it was thrown away. Try again; if it keeps happening, tell whoever runs your Spaghetti."
  say "  ✓ Checksum matches."

  gunzip -c "$work/$name" >"$work/spaghetti-bridge" || fail "Couldn't unpack the download."
  chmod 755 "$work/spaghetti-bridge"
  # A download by curl isn't quarantined, so Gatekeeper doesn't look at it; clear the mark anyway in case a browser or
  # another tool added one. Apple silicon only runs signed programs: sign it here, ad hoc, with no account involved.
  xattr -d com.apple.quarantine "$work/spaghetti-bridge" >/dev/null 2>&1
  if command -v codesign >/dev/null 2>&1; then
    codesign --force --sign - "$work/spaghetti-bridge" >/dev/null 2>&1 || say "  (couldn't sign it; going on)"
  fi
  "$work/spaghetti-bridge" version >/dev/null 2>&1 || fail "The program won't start on this Mac. macOS may have refused it: tell whoever runs your Spaghetti what macOS version this is."

  bin="$HOME/Library/Application Support/$APP_NAME/bin"
  mkdir -p "$bin" || fail "Couldn't make $bin."
  mv -f "$work/spaghetti-bridge" "$bin/spaghetti-bridge" || fail "Couldn't put the program in place."
  say "  ✓ Installed in $bin."

  rm -rf "$work"
  # The questions need the keyboard, and the keyboard isn't this script's input when it is piped from curl.
  if [ -r /dev/tty ] && [ -t 1 ]; then
    exec "$bin/spaghetti-bridge" setup "$@" </dev/tty
  fi
  exec "$bin/spaghetti-bridge" setup "$@"
}

if [ -z "${SPAGHETTI_INSTALL_SOURCE_ONLY:-}" ]; then main "$@"; fi
