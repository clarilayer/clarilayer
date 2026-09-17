# Releasing `clarilayer`

The operational runbook for publishing this package to npm. Publishing is **founder-run and manual** — release PRs prepare everything (version bump, changelog, docs), but nobody and nothing else runs `npm publish`. The commands below use release 0.3.0. Always check the live registry first; a version in this repository does not prove npm publication.

## 1. Pre-publish checklist

Run every check. Any failure stops the release.

- [ ] **On the release commit.** `git checkout main && git pull` — main contains the merged release PR, and `package.json` already carries the new version (the release PR bumps it; there is no publish-time version edit).
- [ ] **Live registry state.** `npm view clarilayer version` prints the *previous* version (0.2.1 before this release). If it already prints the new one, stop — it was already published.
- [ ] **Changelog date.** If the version is still labeled `Unreleased`, prepare and merge a metadata PR replacing that label with the intended publication date; otherwise confirm the recorded date is correct. Let main CI pass on that commit before publishing it. If publication slips, update the date through the same process; do not change the package version at publish time.
- [ ] **Full local gate green.**

  ```bash
  npm ci
  npm run build
  npm run typecheck
  npm test
  ```

- [ ] **CI green on `main`** (the `test` workflow, Node 18 and 22).
- [ ] **Pack contents re-verified.** `npm pack --dry-run` and read the file list:
  - only `dist/**`, `README.md`, `QUICKSTART.md`, `CHANGELOG.md`, `LICENSE`, `package.json`;
  - **must not** contain `test/` (including `test/fixtures/`), `.github/`, `src/`, `scripts/`, `assets/`, `examples/`, `recipes/`, or `server.json`;
  - package size stays **well under 1 MB** (0.2.0 packs at ~41 kB, ~127 kB unpacked, 20 files; a sudden jump means something leaked into `files`).
- [ ] **npm identity and 2FA.** `npm whoami` is the expected account, `npm owner ls clarilayer` lists it as an owner, and two-factor auth is enabled for writes (`npm profile get` → `two-factor auth`), so publish will demand an OTP.

## 2. Publish (founder-run)

```bash
git checkout main && git pull
npm ci
npm publish          # prepublishOnly runs the build; npm prompts for the 2FA OTP
git tag v0.3.0       # tag at publish time, matching the published version
git push origin v0.3.0
```

Optionally draft a GitHub release from the tag, pasting the version's `CHANGELOG.md` section.

## 3. Post-publish smoke

First confirm `npm view clarilayer version` is `0.3.0`. Verify README.md, CLI.md and CHANGELOG.md accurately describe the published version, removing any remaining prepared-only notes through a follow-up PR. Version-qualified commands and registry-check guidance can remain. Do not claim npm publication from a merged source PR alone.

Check the new read-only helper for each client:

```bash
npx -y clarilayer@0.3.0 instructions --agent claude-code
npx -y clarilayer@0.3.0 instructions --agent codex
npx -y clarilayer@0.3.0 instructions --agent cursor
```

Each prints a one-target request, performs no network operation and edits no local file. Check the target, runtime/full guidance, conflict handling and absence of keys. In a disposable project with a connected AI, separately verify a new install and an exact legacy upgrade; confirm unrelated bytes survive and edited/scoped blocks take the appropriate conflict or signed-in Connect path. A successful print is not installation evidence.

In a **clean temp directory** (so no local checkout, `node_modules`, or npx cache can mask a packaging mistake), run the published package against a fixture dbt project:

```bash
cd "$(mktemp -d)"
npx -y clarilayer@0.3.0 --version    # prints 0.3.0

# Fixture project: a target/ with a manifest + catalog pair. Any real dbt
# project after `dbt docs generate` works; for a canned one, fetch a fixture
# pair from this repo:
mkdir -p fixture/target
base=https://raw.githubusercontent.com/clarilayer/clarilayer/main/test/fixtures/phantom-column
curl -fsSLo fixture/target/manifest.json "$base/manifest.json"
curl -fsSLo fixture/target/catalog.json "$base/catalog.json"

npx -y clarilayer@0.3.0 dbt-check --project-dir fixture
# expect: "2 drift findings: 2 phantom columns", one rename hint, exit 0

npx -y clarilayer@0.3.0 dbt-check --project-dir fixture --json | jq .
# expect: stdout parses as pure JSON (status lines are on stderr)

npx -y clarilayer@0.3.0 dbt-check --project-dir fixture --save --dry-run
# expect: the exact JSON-RPC request body on stdout, "nothing was sent" on
# stderr, no key needed, zero network
```

If any of these fail, go straight to Rollback.

## 4. Rollback

Do not `npm unpublish` — it is restricted (72-hour window, version numbers burn forever) and it breaks anyone who already resolved the version. Instead:

```bash
npm deprecate clarilayer@0.3.0 "Broken release: use 0.2.1 with init --no-stanza and update instructions through https://clarilayer.com/connect-ai"
```

Then fix forward: branch, fix, bump to the next patch version, and run this runbook again from the top. Publishing the fixed patch also restores a healthy `latest` tag, since `latest` follows the newest publish.

## 5. Drill: a new dbt minor ships a new artifact schema version

`dbt-check` refuses artifact schema versions it was not validated against (`SUPPORTED_DBT_SCHEMA_VERSIONS`: manifest v10–v12, catalog v1) — by design, never a guessed partial report. When a new dbt minor introduces a new manifest or catalog schema version, users on that dbt hit the refusal and the fix is a **patch release**:

1. **Regenerate real artifacts with the new dbt version** — run `dbt docs generate` on a small real project and diff the new `manifest.json` / `catalog.json` shapes against what the loader and engine read. Update the minimal committed fixtures under `test/fixtures/` to the new schema version (they are hand-trimmed artifacts, not raw dbt output).
2. **Spot-check at scale** — regenerate a perf fixture with `npm run gen:perf-fixture -- --target-mb 50 --out tmp/perf-50` (never commit the blobs) and confirm load + analyze still finish in interactive time, plus one spot-check against a real project's artifacts.
3. **Extend the matrix** — add the new version to `SUPPORTED_DBT_SCHEMA_VERSIONS` in `src/lib/dbt/types.ts` (the loader and the pure engine share it, so they cannot disagree), and fix whatever the tests catch.
4. **Ship a patch release** via this runbook.
