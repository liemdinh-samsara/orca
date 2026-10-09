#!/usr/bin/env bash
# Screenshots a packaged Orca.app launched hidden with a throwaway profile. Use this for
# behavior only a packaged build has (updater, signing, first launch). Extra args go to
# packaged-shot.mjs, e.g. --wait-for '[aria-label="Update available"]' --report-js '...'.
#
#   packaged-proof.sh <path/to/Orca.app> <out.png> [packaged-shot args...]
set -euo pipefail
app="${1:?path to Orca.app}"
out="${2:?output png}"
shift 2

source "$(dirname "$0")/env.sh"
profile="$(mktemp -d "${TMPDIR:-/tmp}/orca-packaged-proof.XXXXXX")"
mkdir -p "$profile/home"
port=$((20000 + RANDOM % 20000))

# Why --use-mock-keychain: with a throwaway HOME, Electron safeStorage otherwise makes macOS
# show "Keychain Not Found … Reset To Defaults" on the user's screen. Never click Reset.
HOME="$profile/home" ORCA_BACKGROUND_LAUNCH=1 \
  ORCA_E2E_USER_DATA_DIR="$profile" ORCA_E2E_HOME_DIR="$profile/home" \
  "$app/Contents/MacOS/Orca" --password-store=basic --use-mock-keychain \
  --remote-debugging-port="$port" > "$profile/app.log" 2>&1 &
app_pid=$!
cleanup() {
  kill "$app_pid" 2>/dev/null || true
  sleep 1
  pkill -f "$profile" 2>/dev/null || true
}
trap cleanup EXIT

node "$(dirname "$0")/packaged-shot.mjs" --port "$port" --out "$out" "$@"
