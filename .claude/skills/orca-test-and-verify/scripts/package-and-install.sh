#!/usr/bin/env bash
# Production build -> unpacked Orca.app for this Mac -> stable signature -> optional install.
#
#   package-and-install.sh            # build + package + sign dist/mac-<arch>/Orca.app
#   package-and-install.sh --install  # ...then replace /Applications/Orca.app and relaunch
set -euo pipefail
install=0
[ "${1:-}" = "--install" ] && install=1

source "$(dirname "$0")/env.sh"
cd "$ORCA_REPO"
arch="$(uname -m)"; [ "$arch" = x86_64 ] && arch=x64
log_dir="$(mktemp -d "${TMPDIR:-/tmp}/orca-package.XXXXXX")"

pnpm run --silent ensure:electron-runtime
echo "[package] pnpm build (log: $log_dir/build.log)"
pnpm build > "$log_dir/build.log" 2>&1 || { tail -30 "$log_dir/build.log" >&2; exit 1; }

# Reuses the repo's own local-version format: <base>-local.<timestamp>.<commit>.
identity_json="$(node --input-type=module -e "import('./config/scripts/build-mac-local.mjs').then((m) => console.log(JSON.stringify(m.getLocalBuildIdentity())))")"
commit="$(node -p "JSON.parse(process.argv[1]).commit" "$identity_json")"
version="$(node -p "JSON.parse(process.argv[1]).version" "$identity_json")"
echo "[package] electron-builder $version (log: $log_dir/pack.log)"
ORCA_BUILD_COMMIT="$commit" ORCA_LOCAL_BUILD_VERSION="$version" \
  pnpm exec electron-builder --config config/electron-builder.config.cjs --mac --dir "--$arch" \
  > "$log_dir/pack.log" 2>&1 || { tail -30 "$log_dir/pack.log" >&2; exit 1; }

app="$ORCA_REPO/dist/mac-$arch/Orca.app"
"$(dirname "$0")/ensure-signing-identity.sh"
codesign --force --deep --sign "${ORCA_LOCAL_SIGN_IDENTITY:-Orca Local Signing}" \
  --entitlements resources/build/entitlements.mac.plist "$app" 2>&1 | grep -v 'replacing existing signature' || true
codesign --verify --deep "$app"
echo "[package] $app"
echo "[package] version $(defaults read "$app/Contents/Info.plist" CFBundleShortVersionString)"
codesign -d -r- "$app" 2>&1 | grep designated

if [ "$install" = 1 ]; then
  stamp="$(date +%Y%m%d-%H%M%S)"
  # Why one step: agent hooks relaunch Orca by bundle id within seconds of a quit, so swap immediately.
  osascript -e 'tell application "Orca" to quit' || true
  for _ in $(seq 1 40); do
    pgrep -f "/Applications/Orca.app/Contents/MacOS/Orca$" >/dev/null || break
    sleep 0.5
  done
  if [ -d /Applications/Orca.app ]; then
    mv /Applications/Orca.app "$HOME/.Trash/Orca-prev-$stamp.app"
  fi
  ditto "$app" /Applications/Orca.app
  sleep 5
  pgrep -f "/Applications/Orca.app/Contents/MacOS/Orca$" >/dev/null || open -g /Applications/Orca.app
  sleep 3
  echo "[install] installed $(defaults read /Applications/Orca.app/Contents/Info.plist CFBundleShortVersionString); previous app in ~/.Trash/Orca-prev-$stamp.app"
  pgrep -fl "/Applications/Orca.app/Contents/MacOS/Orca$" || echo "[install] Orca not running yet; open it from /Applications"
fi
