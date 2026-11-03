#!/bin/bash
# Runs inside CI's manylinux_2_28 builder: builds and smokes one linux orcad node-pty slot.
#   docker run ... -v <repo>:/work:ro -v <outdir>:/out <image> bash /slot.sh <slot> <node-arch>
# Why /build: the prebuild copies read-only pnpm store dirs, which a macOS bind mount refuses to fill.
set -euo pipefail
slot="$1"
node_arch="$2"
# Why any Node 24: it only runs pnpm and the build scripts; the slot compiles against the pinned headers.
node_version="${NODE_VERSION:-24.13.1}"
curl -fsSL "https://nodejs.org/dist/v${node_version}/node-v${node_version}-linux-${node_arch}.tar.xz" -o /tmp/node.tar.xz
mkdir -p /opt/node && tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1
export PATH=/opt/node/bin:$PATH
npm install -g pnpm@12.8.1 >/dev/null
mkdir -p /build
tar -C /work --exclude=node_modules --exclude=./out --exclude=./dist --exclude=./.git -cf - . | tar -C /build -xf -
cd /build
pnpm install --frozen-lockfile --ignore-scripts
export CC=gcc CXX=g++ PYTHON=/opt/python/cp312-cp312/bin/python3
pnpm build:orcad-prebuilds --slot="$slot"
pnpm build:orcad-prebuilds --require-slots "$slot"
pnpm build:orcad-prebuilds --slot="$slot" --smoke
cp -R out/orcad-prebuilds/. /out/
echo "[orcad-slot] $slot ok"
