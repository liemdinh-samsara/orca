# Source me: puts Node 24 + pnpm on PATH and exports ORCA_REPO.
# package.json pins engines.node=24; newer system Node breaks native module builds.

ORCA_REPO="$(git -C "$(dirname "${BASH_SOURCE[0]:-$0}")" rev-parse --show-toplevel)"
export ORCA_REPO

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null; }

if [ "$(node_major)" != "24" ]; then
  # Homebrew's node@24 link can point at a newer major, so check each candidate's real version.
  # find + while-read instead of globs/word-splitting so this works sourced from bash or zsh.
  node24_bin="$(
    {
      echo "$HOME/.local/opt/node24/bin"
      find "$HOME/.nvm/versions/node" -maxdepth 1 -name 'v24*' 2>/dev/null | sed 's|$|/bin|'
      echo /opt/homebrew/opt/node@24/bin
      echo /usr/local/opt/node@24/bin
    } | while IFS= read -r candidate; do
      if [ -x "$candidate/node" ] && [ "$("$candidate/node" -p 'process.versions.node.split(".")[0]')" = "24" ]; then
        echo "$candidate"
        break
      fi
    done
  )"
  if [ -n "$node24_bin" ]; then
    export PATH="$node24_bin:$PATH"
  fi
  unset node24_bin
fi
if [ "$(node_major)" != "24" ]; then
  echo "orca-test-and-verify: Node 24 not found (have $(node -v 2>/dev/null || echo none)). Install it to ~/.local/opt/node24 or 'nvm install 24'." >&2
  return 1 2>/dev/null || exit 1
fi

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable pnpm
fi
