---
name: fork-upstream-sync
description: Weekly sync of this Orca fork (liemdinh-samsara/orca) with upstream stablyai/orca main - merge upstream into a sync/upstream-<date> branch, resolve conflicts so every fork feature survives, run the fork contract gate (registry check, typecheck, fork unit/mobile/e2e tests), prove the desktop app and the iOS app in the Simulator, publish a validation report and open a PR for the owner to merge. Use when the weekly "Upstream sync" Orca automation runs, or when someone asks to sync, merge or catch up the fork with upstream, even if they don't name the skill.
---

# Fork upstream sync

This repo is a personal fork that its owner builds and runs daily. Upstream lands ~120 commits a day. Once a
week this skill merges upstream `main` into a branch, keeps every fork feature working, proves it in the
running apps, and opens a PR. The owner merges the PR; this skill never moves `main`.

The fork's features, the files they own and their tests are listed in `config/fork/fork-features.json`.
`config/scripts/fork-contract.mjs` checks that list against the real diff and runs the tests.
`config/scripts/fork-upstream-sync.mjs` does the git and PR mechanics. Read `AGENTS.md` first; its rules apply.

## Hard rules

- Never push to `main`, never force-push, never rewrite history, never `git reset --hard` a branch you didn't create.
  `publish` only pushes `sync/*` branches.
- Never install a build into `/Applications` or quit the owner's running Orca. Build into `dist/` only.
- Every app launch is hidden: `ORCA_BACKGROUND_LAUNCH=1`, CDP screenshots, `--password-store=basic
  --use-mock-keychain` for throwaway profiles. Never computer-use, never steal focus.
- Never start `orca serve` from an Orca terminal (it clobbers the app's bundled CLI); use the dist binary as in
  `references/app-proof.md`.
- Never delete, skip or weaken a fork test to get green. Fix the fork code, or mark the feature as needing the
  owner in the PR.
- Proof screenshots show disposable fixtures only.

## 0. Prepare (≈10 min)

```bash
test "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)" || { echo "Refusing: not a linked worktree"; exit 1; }
source .claude/skills/orca-test-and-verify/scripts/env.sh          # Node 24 + pnpm
RUN_DIR="$(git rev-parse --git-path fork-sync)/run-$(date +%Y-%m-%d)"; mkdir -p "$RUN_DIR"; RUN_DIR="$(cd "$RUN_DIR" && pwd)"
git fetch origin --prune && git switch --detach origin/main          # BEFORE = the fork as the owner runs it
pnpm install --frozen-lockfile && (cd mobile && pnpm install --frozen-lockfile)
```

Write everything for this run (screenshots, gate JSON, resolutions, manifest) under `$RUN_DIR`.

## 1. Capture BEFORE (desktop)

Follow "Desktop BEFORE/AFTER" in `references/app-proof.md` with `PROOF_LABEL=before`. It uses the committed
proof spec `assets/fork-proof.spec.ts`, so BEFORE and AFTER show the same screens.

## 2. Start the merge

```bash
node config/scripts/fork-upstream-sync.mjs start --base origin/main --json | tee "$RUN_DIR/start.json"
```

- Exit 0 + `up-to-date`: write one line to the final message and stop. No PR.
- Exit 0 + `merged`: go to step 4.
- Exit 2 + `conflicts`: step 3.
- Exit 3 (dirty tree or merge in progress) or 1: stop and report the message; don't improvise git surgery.

## 3. Resolve conflicts

Follow `references/conflict-resolution.md`. Record one bullet per conflicted file in `$RUN_DIR/resolutions.md`:
what conflicted, what you kept, why. Then `git add` the files and `git commit --no-edit` to conclude the merge.

## 4. Gate

Run in order. When a step fails because of the merge, fix the fork side and commit each fix separately
(`fix: adapt <feature id> to upstream <what changed>`), then re-run from that step.

```bash
pnpm install --frozen-lockfile && (cd mobile && pnpm install --frozen-lockfile)   # upstream may change deps
node config/scripts/fork-contract.mjs check            # every fork change still registered with tests
pnpm tc
pnpm exec oxlint $(git diff --name-only HEAD^1 -- '*.ts' '*.tsx' '*.mjs')   # files the merge/fixes touched
node config/scripts/fork-contract.mjs run --kinds unit,mobile,checks,e2e --json-out "$RUN_DIR/gate.json"
```

- `check` fails when upstream moved or renamed a fork-owned file: update the feature's `paths` in
  `config/fork/fork-features.json` and commit (`chore: track <feature> files after upstream move`).
- A failure in an upstream test you didn't touch: re-run that file on `upstream/main` in a scratch worktree
  (`git worktree add "$RUN_DIR/upstream" upstream/main`). If it fails there too, it is pre-existing; note it in the
  PR and move on.
- Give up on a failure after two honest attempts. The PR then opens as a draft that says exactly what fails.

## 5. Prove the apps

Follow `references/app-proof.md`:
- Desktop AFTER with the same proof spec (`PROOF_LABEL=after`), then read every after/before pair yourself.
- `node config/scripts/fork-upstream-sync.mjs summary --json > "$RUN_DIR/summary.json"` lists the fork features
  the merge touched. Exercise each `desktop`/`both` one with its registry `appProof.steps`.
- Mobile: build the iOS Simulator app, pair it with a headless host built from this branch, screenshot the
  screens of every `mobile`/`both` feature plus the session list and a chat.

If something can't be exercised (no Simulator runtime, Xcode broke), say so plainly in the report and PR.

## 6. Report and PR

1. Write `$RUN_DIR/manifest.json` (format in `.claude/skills/orca-test-and-verify/scripts/build-report.py`):
   a sync summary section, one before/after section per desktop screen, mobile screenshots as `extra`, the gate
   table (from `gate.json`), conflict resolutions and anything for the owner to check by hand.
2. `python3 .claude/skills/orca-test-and-verify/scripts/build-report.py "$RUN_DIR/manifest.json" "$RUN_DIR/report.html"`
3. Publish it with the `liem-upload-report` skill (slug `orca-upstream-sync-<date>`); keep the URL.
4. ```bash
   node config/scripts/fork-upstream-sync.mjs pr-body --gate "$RUN_DIR/gate.json" \
     --resolutions "$RUN_DIR/resolutions.md" --report-url "<url>" --out "$RUN_DIR/pr.md"
   node config/scripts/fork-upstream-sync.mjs publish --title "chore: sync upstream stablyai/orca main ($(date +%Y-%m-%d))" \
     --body-file "$RUN_DIR/pr.md" [--draft]       # --draft when any gate result failed or proof is missing
   ```

## 7. Clean up and report

Stop every app, host and Simulator you started; delete throwaway profiles; restore the `orca` CLI symlink if the
host moved it (see `references/app-proof.md`). Leave the worktree; Orca shows it with the run.

Final message, lead with the result: PR link, report link, upstream commit count, conflicts and how they were
resolved (one line each), gate results with any failures, which fork features were proven on desktop and
mobile, and what the owner must check by hand before merging.

## Keeping the gate honest

Every fork change must be registered: when a session adds or changes a fork feature, it adds or updates the
feature entry (owned `paths`, tests, `appProof`) and `node config/scripts/fork-contract.mjs check` passes before
committing. A sync that finds an unregistered file treats it as a bug in the registry and registers it with
tests, not as an exemption.
