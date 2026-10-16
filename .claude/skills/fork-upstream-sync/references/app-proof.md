# Proving a sync in the running apps

Tests show the code ran; screenshots show the fork still does what its owner uses it for. Every launch below is
hidden and uses throwaway profiles. Write all output under `$RUN_DIR`.

## Desktop BEFORE/AFTER

`assets/fork-proof.spec.ts` drives every desktop fork feature and screenshots it. The same file runs against
BEFORE (`origin/main`, step 1) and AFTER (the merged branch, step 5). It must stay untracked in the repo:

```bash
SPEC=tests/e2e/zz-proof-fork-sync.spec.ts
cp .claude/skills/fork-upstream-sync/assets/fork-proof.spec.ts "$SPEC"
.claude/skills/orca-test-and-verify/scripts/capture-before-after.sh before "$SPEC" "$RUN_DIR/proof"   # or: after
rm "$SPEC"        # before `fork-upstream-sync.mjs start`, which refuses an untracked file
```

Open every `before-*.png` / `after-*.png` pair with the Read tool. Each AFTER must show the same fork behavior as
its BEFORE (layout drift from upstream is fine; a missing fork control, pane or menu item is a regression). A
screenshot of the wrong state (onboarding modal, empty pane) proves nothing: fix the spec and re-capture.

Features the spec can't reach (packaged-only behavior such as update checks, SSH hosts, Okta pages) are proven
by their e2e specs in the gate; list them in the report as "covered by tests, not screenshotted".

## Packaged build

```bash
.claude/skills/orca-test-and-verify/scripts/package-and-install.sh        # NO --install: never replace the owner's app
.claude/skills/orca-test-and-verify/scripts/packaged-proof.sh dist/mac-*/Orca.app "$RUN_DIR/proof/after-packaged.png"
```

The packaged screenshot proves the signed app boots with this merge. `dist/mac-*/Orca.app` is also the mobile host.

## Mobile (iOS Simulator)

The owner's phone runs an OTA-shell build (`EXPO_PUBLIC_MOBILE_SHELL=ota`): its main screens are a web bundle the
paired desktop serves, so pairing with this branch's host checks both the native shell and the served screens.

1. **Host.** Start the dist app headless with its own short profile (the Unix socket path limit is 104 chars) and
   the app's `bin` stripped from `PATH` (otherwise its CLI installer overwrites the owner's bundled `orca`):
   ```bash
   P="$TMPDIR/osp-sync"; rm -rf "$P"; mkdir -p "$P"
   CLEAN_PATH="$(printf %s "$PATH" | tr ':' '\n' | grep -v '/Orca.app/Contents/Resources/bin' | paste -sd: -)"
   env PATH="$CLEAN_PATH" ORCA_USER_DATA_PATH="$P" ORCA_SERVE_USER_DATA_PATH="$P" ORCA_BACKGROUND_LAUNCH=1 \
     dist/mac-arm64/Orca.app/Contents/MacOS/Orca --user-data-dir="$P" --password-store=basic --use-mock-keychain \
     --serve --port 6790 --pairing-address 127.0.0.1 --mobile-pairing > "$RUN_DIR/host.log" 2>&1 &
   ```
   Without `--use-mock-keychain` it blocks forever on a keychain prompt. The pairing URL appears in `host.log`.
2. **App.** In `mobile/`: `npx expo prebuild --platform ios` only if native deps changed (it regenerates the
   gitignored `ios/`). After any prebuild, re-add the Xcode 27 `post_install` block that raises pod
   `IPHONEOS_DEPLOYMENT_TARGET` below 15.0 to 15.0, then `pod install` in `ios/`. Build:
   ```bash
   EXPO_PUBLIC_MOBILE_SHELL=ota xcodebuild -workspace ios/Orca.xcworkspace -scheme Orca -configuration Release \
     -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' ARCHS=arm64 IPHONEOS_DEPLOYMENT_TARGET=16.0 \
     -derivedDataPath ios/build > "$RUN_DIR/xcodebuild.log" 2>&1
   ```
3. **Simulator.** Use an existing iPhone device (`xcrun simctl list devices available`), then
   `xcrun simctl boot <udid>`, `xcrun simctl install <udid> ios/build/Build/Products/Release-iphonesimulator/Orca.app`,
   `xcrun simctl launch <udid> <bundle id from the built Info.plist>`.
4. **Pair.** `xcrun simctl openurl <udid> "<pairing url>"`. The first deep link shows "Open in Orca?"; later ones go
   straight to the pair screen. Drive taps with `orca emulator attach <udid> --worktree path:$PWD`, then
   `orca emulator tap <x> <y> --worktree path:$PWD --device <udid>` (normalized 0–1 coordinates) and `orca emulator
   type`. idb can't tap on Xcode 27; `type` can't send backspace.
5. **Screens.** `xcrun simctl io <udid> screenshot "$RUN_DIR/proof/mobile-<name>.png"` for: the paired host's
   session list, a chat, and each `mobile`/`both` feature's `appProof.steps` (e.g. the chat "/" skills menu).
   Read each screenshot; a spinner or an error banner is a failure to investigate, not proof.

## Clean up (always, even after a failure)

```bash
xcrun simctl terminate <udid> <bundle id>; xcrun simctl shutdown <udid>
kill <host pid>; rm -rf "$P"
ls -la /Applications/Orca.app/Contents/Resources/bin/orca      # must still be a regular ~1 KB script
readlink /opt/homebrew/bin/orca || true                         # a dist host may re-point it; restore with:
ln -sfn /Applications/Orca.app/Contents/Resources/bin/orca /opt/homebrew/bin/orca
```
