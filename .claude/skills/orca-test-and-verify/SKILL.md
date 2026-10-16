---
name: orca-test-and-verify
description: End-to-end workflow for changing this Orca fork and proving the change works - capture BEFORE screenshots, make the change, run the checks and e2e tests, capture AFTER screenshots, package and install the local Mac build, publish a before/after validation page, then commit and push to main. Use whenever someone asks to add, fix or tweak an Orca feature or setting in this repo, rebuild/reinstall their local Orca, "test this change", "show me before and after", "prove it works", or "ship it to main" - even if they don't name the skill.
---

# Orca: test, verify, ship

This repo is a personal fork of Orca that its owner builds and runs as their daily app. Every change follows the same loop. The proof matters as much as the code: someone who wasn't in the session must be able to open one page and see that the change does what was asked.

1. Plan the proof: what should BEFORE vs AFTER show?
2. Capture BEFORE (screenshots of the current behavior)
3. Make the change, with tests
4. Verify: type, lint and quality gates, unit tests, e2e
5. Capture AFTER and look at it yourself
6. Package, sign, install the local build
7. Publish the validation page (Claude artifact, else internal S3)
8. Commit and push to `main`
9. Report back with the link

Repo rules in `AGENTS.md` (style guide, max-lines, reuse, SSH/folder workspaces, cross-platform) always apply. This skill adds the build, proof and ship mechanics.

## Ground rules

- **Branch:** work and push on `main` of `origin` (the fork). Never push to upstream `stablyai/orca`; check with `git remote -v` if unsure.
- **Hidden launches:** every app launch is hidden. Use `ORCA_BACKGROUND_LAUNCH=1` and CDP screenshots, never computer-use, and never steal focus.
- **Keychain flags:** any launch with a throwaway `HOME` needs `--password-store=basic --use-mock-keychain` (the scripts below do this). Without it, macOS pops "Keychain Not Found … Reset To Defaults" on the user's screen. If the user sees that dialog, tell them to click **Cancel**: Reset replaces their login keychain.
- **Where proof goes:** proof artifacts go to Claude artifacts or Samsara's internal S3 viewer, never gists, pastebins or personal hosting.
- **Screenshot content:** screenshots should show disposable e2e fixtures only. If one would show the user's real projects, customer data or credentials, publish it only to internal S3.

## Setup

```bash
source .claude/skills/orca-test-and-verify/scripts/env.sh   # Node 24 + pnpm on PATH, $ORCA_REPO
pnpm install                                                # first time; also `cd mobile && pnpm install`
```

`package.json` pins Node 24, and a newer system Node breaks native modules. Native modules are built for one runtime at a time:

- Unit tests need `node config/scripts/ensure-native-runtime.mjs --runtime=node`.
- E2E runs and packaging need `pnpm run ensure:electron-runtime`.

The scripts switch runtimes for you. Run the switch yourself only when calling vitest directly.

## 1. Plan the proof

Before touching code, decide what a reviewer needs to see. Write it down as one sentence per change: "Before: X. After: Y." Then pick how to capture it:

- **Renderer behavior** (panes, tabs, settings, sidebar, dialogs): use an untracked e2e proof spec. Copy `assets/proof-shots.spec.template.ts` to `tests/e2e/zz-proof-<slug>.spec.ts`.
  - Drive the flow the way a person would: the store action a button calls, or the UI itself.
  - Call `shot()` at the moment that shows the difference, and `record()` the state behind it.
  - The same file runs against both builds, so use only APIs that exist before *and* after the change.
- **Packaged-only behavior** (update checks, signing, first launch, anything that depends on `app.isPackaged`): use `scripts/packaged-proof.sh` against a packaged `Orca.app`. The current `/Applications/Orca.app` or `dist/mac-*/Orca.app` is your BEFORE until you rebuild.
- **Can't be captured** (a real SSO login, hardware): say so in the report and ask the user to check it by hand.

## 2. Capture BEFORE

```bash
S=<scratch dir, e.g. the session scratchpad>/proof
.claude/skills/orca-test-and-verify/scripts/capture-before-after.sh before tests/e2e/zz-proof-<slug>.spec.ts "$S"
```

The script builds `HEAD` in e2e mode and runs the spec with `PROOF_LABEL=before`, writing `before-*.png` and `before-*.json` into `$S`. If you have already edited code, it stashes those edits for the BEFORE build and restores them afterwards, even on failure. The untracked proof spec stays in place.

For packaged behavior:

```bash
.claude/skills/orca-test-and-verify/scripts/packaged-proof.sh /Applications/Orca.app "$S/before-update.png" \
  --wait-for '[aria-label="Update available"]' --timeout 60000 --report-js 'window.api.updater.getStatus()'
```

`packaged-proof.sh` hides dialogs and toasts before the screenshot, because a hidden window ignores clicks and Escape. Pass `--keep-overlays` if the overlay *is* the thing being proven. Crop with `sips -c <h> <w> --cropOffset <y> <x> in.png --out out.png` when the relevant bit is small. sips ignores an offset of `0 0` and crops the center, so use `1 1` to crop from the top-left.

Open each BEFORE image with the Read tool. A screenshot of the wrong state, such as an onboarding modal or an empty pane, proves nothing.

## 3. Make the change

- Search for an existing implementation first (AGENTS.md "Reuse Before Reimplementing"). In this session, the browser right-pane placement reused the mobile emulator's `findReusableRightSplitGroupId`.
- Add unit tests for the logic and a **committed** e2e spec (not `zz-proof-*`) that asserts the new behavior, so it stays covered.
- When a behavior change breaks upstream tests, update them only when the new behavior is intended. If the change touches a path the request didn't cover, scope it out instead. Example: moving tabs on the paired-runtime (remote Orca server) path broke 5 specs and stole focus, so that path was excluded.
- Upstream e2e helpers seed repos through `window.api.repos.add`. If you change a new-project default, opt the fixtures out in `tests/e2e/helpers/orca-app.ts` and `orca-restart.ts`, the way `inPlaceWorkspaces: false` is set there.
- User-facing strings use `translate(key, default)`; run `pnpm run sync:localization-catalog`.
- Register the change in `config/fork/fork-features.json`: a new feature entry, or the existing feature's `paths`, tests and `appProof`. The weekly upstream sync runs exactly these tests, so an unregistered change is unprotected.

## 4. Verify

Run these and fix anything your change caused:

```bash
pnpm tc                                        # or tc:node / tc:web
pnpm exec oxlint <changed files>
pnpm run check:code-quality:changed            # no type assertions, no restyled ui primitives, max-lines
pnpm exec oxfmt --check <changed files>
node config/scripts/ensure-native-runtime.mjs --runtime=node
pnpm exec vitest run --config config/vitest.config.ts <dirs you touched>
node config/scripts/fork-contract.mjs check            # every fork change registered with tests
node config/scripts/fork-contract.mjs run              # all fork unit, mobile and check tests
```

Without `--config config/vitest.config.ts`, hundreds of unrelated tests fail on missing app environment setup. Don't chase those.

For e2e, build once in e2e mode and then iterate with `SKIP_BUILD=1`:

```bash
pnpm run ensure:electron-runtime
VITE_EXPOSE_STORE=true npx electron-vite build --mode e2e
SKIP_BUILD=1 ORCA_BACKGROUND_LAUNCH=1 pnpm exec playwright test tests/e2e/<new>.spec.ts <related specs> \
  --config tests/playwright.config.ts --project electron-headless
```

Pick related specs by grepping `tests/e2e` for the store actions or UI text you touched, and run them. Watch for these:

- **`waitForFunction(window.__store)` timeout:** `out/` holds a production build from `pnpm build`. Rebuild in e2e mode.
- **A click right after a drag does nothing:** dnd-kit swallows clicks for 50ms after a drop. Wait about 100ms in the spec.
- **A failure you didn't expect:** check it on unmodified `main` before blaming your change; some suites fail there already. Report pre-existing failures as such.

## 5. Capture AFTER

```bash
.claude/skills/orca-test-and-verify/scripts/capture-before-after.sh after tests/e2e/zz-proof-<slug>.spec.ts "$S"
```

Read every `after-*.png` next to its `before-*.png`. A passing test only shows the code ran. Looking at the screenshots shows it does what the user asked: the right pane, the switch state, the missing card. If AFTER doesn't clearly differ from BEFORE in the way the plan said, the proof or the change is wrong. Fix it before moving on.

## 6. Package, sign, install

```bash
.claude/skills/orca-test-and-verify/scripts/package-and-install.sh --install
```

This runs `pnpm build`, then electron-builder `--dir` for this Mac's arch with a `<base>-local.<timestamp>.<commit>` version, then signing and install.

- **Signing:** it signs with the self-signed "Orca Local Signing" identity, creating it on first use. Never sign ad-hoc (`--sign -`). Ad-hoc signing ties keychain trust to each build's hash, so the "orca Safe Storage" password prompt returns after every reinstall even with Always Allow. With the stable identity the user clicks Always Allow once.
- **Install:** it quits Orca and immediately swaps `/Applications/Orca.app`; the old copy goes to `~/.Trash`. The swap happens right away because agent hooks relaunch Orca by bundle ID within seconds. Terminals survive because the terminal daemon keeps running.
- **Quit refused:** if the script warns that Orca did not quit (its own quit confirmation can hold it), the user is still on the previous build. Don't force-kill their app; tell them to quit and reopen Orca, and say so in the report.
- **Local builds:** they skip background update checks. "Check for Updates" would still offer the official release and replace the local build, so tell the user not to click it.

For packaged-only proof, run `packaged-proof.sh dist/mac-*/Orca.app "$S/after-….png" …` before installing.

## 7. Publish the validation page

Write `$S/manifest.json` covering every section: what changed, before/after image pairs with captions quoting the recorded state, the test table, and manual checks. The format is in the header of `scripts/build-report.py`. Then build the page:

```bash
python3 .claude/skills/orca-test-and-verify/scripts/build-report.py "$S/manifest.json" "$S/orca-proof.html" --fragment
```

`--fragment` leaves out the `<html>`/`<body>` wrapper, which a Claude artifact adds itself. Drop it for the S3 upload, which serves the file as-is.

Publish it:

- **Claude artifact (preferred, when the Artifact tool is available):** publish `orca-proof.html`, following the tool's own instructions (it may require loading a design skill first). Fixture-only screenshots are fine there.
- **Otherwise, or if any screenshot shows real user data:** use the `samsara-upload-report` skill. Upload to `operational-ai/<user>/orca_local_build/<descriptive-name>.html` with `--content-type text/html` and verify with `head-object`.

Write captions for someone who never saw the session: plain language, what they'd notice as a user, and the mechanism in one line.

## 8. Commit and push to main

- Delete or move the `zz-proof-*` spec out of the repo; it is never committed.
- Make one commit per logical change, with its tests. Follow the user's commit-message conventions and any rule about showing the message for approval first.
- Scan the diff for secrets, then:

```bash
git push origin main
git fetch origin && git status -sb    # expect "## main...origin/main" with nothing ahead or behind
```

## 9. Report

Lead with the result. Include:

- The validation-page link.
- For each change, one line on before and after.
- What was tested and what wasn't, including pre-existing failures.
- The installed version.
- Anything the user must check by hand.
