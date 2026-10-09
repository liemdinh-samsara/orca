#!/usr/bin/env bash
# Runs an untracked proof spec against the BEFORE or AFTER code and saves its screenshots.
#
#   capture-before-after.sh before <spec> <out-dir>   # HEAD without your working-tree changes
#   capture-before-after.sh after  <spec> <out-dir>   # HEAD plus your working-tree changes
#
# The spec must live in tests/e2e/ and stay untracked (name it zz-proof-*.spec.ts). It reads
# PROOF_DIR and PROOF_LABEL; see assets/proof-shots.spec.template.ts.
set -euo pipefail
phase="${1:?before|after}"
spec="${2:?path to tests/e2e/zz-proof-*.spec.ts}"
out_dir="${3:?output directory}"

source "$(dirname "$0")/env.sh"
cd "$ORCA_REPO"
mkdir -p "$out_dir"
out_dir="$(cd "$out_dir" && pwd)"
spec_rel="$(python3 -c 'import os,sys; print(os.path.relpath(os.path.abspath(sys.argv[1]), sys.argv[2]))' "$spec" "$ORCA_REPO")"

if git ls-files --error-unmatch "$spec_rel" >/dev/null 2>&1; then
  echo "Proof spec $spec_rel is tracked; keep it untracked so the BEFORE stash leaves it in place." >&2
  exit 1
fi

stashed=0
restore() {
  if [ "$stashed" = 1 ]; then
    git stash pop --quiet && echo "[proof] restored working-tree changes"
  fi
}
trap restore EXIT

if [ "$phase" = before ]; then
  paths_file="$(mktemp)"
  { git diff --name-only HEAD; git ls-files --others --exclude-standard; } \
    | grep -vxF "$spec_rel" | grep -v -e '^test-results/' -e '^\.claude/' | sort -u > "$paths_file" || true
  if [ -s "$paths_file" ]; then
    # Why: BEFORE must be the code without this change; the untracked proof spec stays behind.
    git stash push --include-untracked --quiet -m "orca-proof-before" --pathspec-from-file="$paths_file"
    stashed=1
    echo "[proof] stashed $(wc -l < "$paths_file" | tr -d ' ') changed path(s) for the BEFORE build"
  fi
elif [ "$phase" != after ]; then
  echo "phase must be before or after" >&2
  exit 1
fi

pnpm run --silent ensure:electron-runtime
# Why: e2e mode exposes window.__store; a production `pnpm build` in out/ makes every spec time out.
echo "[proof] building $phase (electron-vite --mode e2e)"
VITE_EXPOSE_STORE=true npx electron-vite build --mode e2e > "$out_dir/$phase-build.log" 2>&1 \
  || { tail -30 "$out_dir/$phase-build.log" >&2; exit 1; }

set +e
SKIP_BUILD=1 ORCA_BACKGROUND_LAUNCH=1 PROOF_DIR="$out_dir" PROOF_LABEL="$phase" \
  pnpm exec playwright test "$spec_rel" --config tests/playwright.config.ts --project electron-headless \
  > "$out_dir/$phase-playwright.log" 2>&1
status=$?
set -e
grep -E '✓|✘|passed|failed' "$out_dir/$phase-playwright.log" | tail -5
ls -1 "$out_dir" | grep -E "^$phase-.*\.(png|json)$" || true
exit $status
