# Source me: puts Node 24 + pnpm on PATH and exports ORCA_REPO.
# package.json pins engines.node=24; newer system Node breaks native module builds.

ORCA_REPO="$(git -C "$(dirname "${BASH_SOURCE[0]:-$0}")" rev-parse --show-toplevel)"
export ORCA_REPO

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null; }

if [ "$(node_major)" != "24" ]; then
  for candidate in "$HOME"/.nvm/versions/node/v24*/bin /opt/homebrew/opt/node@24/bin /usr/local/opt/node@24/bin; do
    if [ -x "$candidate/node" ]; then
      export PATH="$candidate:$PATH"
      break
    fi
  done
fi
if [ "$(node_major)" != "24" ]; then
  echo "orca-test-and-verify: Node 24 not found (have $(node -v 2>/dev/null || echo none)). Install it, e.g. 'nvm install 24'." >&2
  return 1 2>/dev/null || exit 1
fi

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable pnpm
fi
