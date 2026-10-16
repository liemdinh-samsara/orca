# Resolving upstream merge conflicts

Goal: the merged tree has all of upstream's changes **and** every fork feature still behaves as its tests and
`appProof` describe. Upstream is the base you adapt to; the fork's behavior is what you preserve.

## For each conflicted file

1. Who owns it: `node config/scripts/fork-contract.mjs owners <file> --json`, then read that feature's entry in
   `config/fork/fork-features.json` (title, commits, tests).
2. What the fork intended: `git show <commit> -- <file>` for the feature's commits.
3. What upstream changed: `git log --oneline <baseSha>..<upstreamSha> -- <file>` and the diff
   (`baseSha`/`upstreamSha` are in `$RUN_DIR/start.json`). Read the upstream PR titles; they often explain the
   intent (`gh pr view <n> --repo stablyai/orca --json title,body` when a subject ends in `(#NNNNN)`).
4. Resolve so both intents hold. Usually that means re-applying the fork's small change on top of upstream's new
   code, not keeping the fork's old copy of the whole region.
5. Run that feature's unit tests right away (`node config/scripts/fork-contract.mjs run --kinds unit --features <id>`).

## Common cases

- **Upstream refactored code the fork patched** (moved, renamed, split a file): port the fork change into the new
  location, then update the feature's `paths`.
- **Upstream shipped the same capability**: prefer upstream's implementation. Keep the fork's tests if they still
  describe behavior the owner wants and pass against upstream's code; otherwise retire the feature: remove its
  entry and fork-only files, and put "Retired fork feature `<id>`: upstream now provides it via <PR>" at the top of
  `resolutions.md`. The owner decides when merging, so be explicit.
- **Both sides edited a test file**: keep upstream's tests and the fork's tests. Never delete a fork test case.
- **Generated or derived files** (`pnpm-lock.yaml`, `mobile/pnpm-lock.yaml`, localization catalogs, RPC params
  catalog, skill bundle manifests): take upstream's version (`git checkout --theirs <file>`), then regenerate with
  the repo's script (`pnpm install --lockfile-only`, `pnpm run sync:localization-catalog`,
  `node config/scripts/generate-rpc-params-catalog.mjs`, …) so fork additions come back.
- **`AGENTS.md` / docs**: keep both texts; fork sections stay where they are.
- **Delete/modify conflicts**: if upstream deleted a file the fork modified, find where the code went (`git log
  --diff-filter=D --follow -- <file>` on upstream) and port the change there.

## When you can't preserve a feature

If keeping a fork feature would mean reverting meaningful upstream work, or you aren't confident the merged code is
right after two attempts: keep upstream's version, leave the feature's tests failing (don't skip them), open the PR
as a draft, and explain in `resolutions.md` what broke, why, and what the owner needs to decide.
