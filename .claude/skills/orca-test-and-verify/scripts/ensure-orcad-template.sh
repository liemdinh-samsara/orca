#!/usr/bin/env bash
# Builds out/orcad-template: the server every SSH connect deploys. A build without it cannot use
# any SSH host ("this Orca build doesn't include the server"), so this fails rather than skip.
#
# Linux node-pty slots are compiled in CI's manylinux_2_28 builders under Docker (a Mac cannot
# build them natively) and cached per node-pty patch + pinned Node, so they build once.
set -euo pipefail
source "$(dirname "$0")/env.sh"
cd "$ORCA_REPO"
scripts="$(cd "$(dirname "$0")" && pwd)"
arch="$(uname -m)"; [ "$arch" = x86_64 ] && arch=x64
slots=(linux-x64-glibc linux-arm64-glibc "darwin-$arch")
# Same builder images as .github/workflows/ssh-hostile-hosts.yml and .github/workflows/node-server-tests.yml.
image_for() {
  case "$1" in
    linux-x64-glibc) echo "linux/amd64 x64 quay.io/pypa/manylinux_2_28_x86_64@sha256:407f771c51a2c3e83ebe5a7970b4289ead3a6db21d9b9c089168775cad11d328" ;;
    linux-arm64-glibc) echo "linux/arm64 arm64 quay.io/pypa/manylinux_2_28_aarch64@sha256:c22ffd129ac99a8a42d1f2c2f4e88a9089288dd9ee987a7092da1c7dc48f27a9" ;;
  esac
}

patch_sha="$(cat config/patches/node-pty@*.patch | shasum -a 256 | cut -c1-12)"
pin="$(node --input-type=module -e "import('./src/shared/node-runtime-pin.ts').then((m) => console.log(m.NODE_RUNTIME_PIN.version))" 2>/dev/null)"
cache="${ORCA_ORCAD_SLOT_CACHE:-$HOME/.cache/orca-local-build/orcad-prebuilds}/$patch_sha-node$pin"
prebuilds="$ORCA_REPO/out/orcad-prebuilds"
mkdir -p "$cache" "$prebuilds"

has_slot() { node config/scripts/build-orcad-prebuilds.mjs --require-slots "$1" >/dev/null 2>&1; }
in_cache() { [ -d "$cache/$1" ] && node -e "process.exit(require('$cache/manifest.json').slots?.['$1'] ? 0 : 1)" 2>/dev/null; }

for slot in "${slots[@]}"; do
  if has_slot "$slot"; then
    in_cache "$slot" || node "$scripts/orcad-slot-cache.mjs" "$prebuilds" "$cache" "$slot"
    continue
  fi
  if in_cache "$slot"; then
    node "$scripts/orcad-slot-cache.mjs" "$cache" "$prebuilds" "$slot"
  elif [[ "$slot" == darwin-* ]]; then
    echo "[orcad] building $slot natively"
    pnpm build:orcad-prebuilds --slot="$slot" >/dev/null
    node "$scripts/orcad-slot-cache.mjs" "$prebuilds" "$cache" "$slot"
  else
    docker info >/dev/null 2>&1 || { echo "[orcad] Docker is required once to build the $slot server slot" >&2; exit 1; }
    read -r platform node_arch image <<<"$(image_for "$slot")"
    work="$(mktemp -d "${TMPDIR:-/tmp}/orcad-slot.XXXXXX")"
    echo "[orcad] building $slot in Docker (one-time, ~15 min emulated; log: $work/build.log)"
    docker run --rm --platform "$platform" -v "$ORCA_REPO:/work:ro" -v "$work:/out" \
      -v "$scripts/orcad-linux-slot-in-container.sh:/slot.sh:ro" "$image" bash /slot.sh "$slot" "$node_arch" \
      > "$work/build.log" 2>&1 || { tail -20 "$work/build.log" >&2; exit 1; }
    node "$scripts/orcad-slot-cache.mjs" "$work" "$cache" "$slot"
    node "$scripts/orcad-slot-cache.mjs" "$cache" "$prebuilds" "$slot"
  fi
  has_slot "$slot" || { echo "[orcad] $slot slot failed verification" >&2; exit 1; }
done

targets="$(IFS=,; echo "${slots[*]}")"
echo "[orcad] building the server template for $targets"
node config/scripts/build-orcad-template.mjs --targets "$targets" > "${TMPDIR:-/tmp}/orcad-template.log" 2>&1 ||
  { tail -20 "${TMPDIR:-/tmp}/orcad-template.log" >&2; exit 1; }
tail -1 "${TMPDIR:-/tmp}/orcad-template.log"
