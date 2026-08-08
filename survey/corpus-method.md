# Public dbt artifact corpus — how it was built

Goal: find public dbt projects where **both** `manifest.json` and `catalog.json` are
fetchable without authentication, so `clarilayer dbt-check` can be run across them.

Output: `corpus-candidates.json` (in this directory) — an array of 426 candidate entries, 324 marked `usable: true`.
Every entry was verified by actually fetching both files once and parsing them; nothing in
this file is inferred from a filename or a search-result snippet.

Date of survey: 2026-08-07. All `generated_at` / size figures are as of that date.

---

## Headline numbers

| Measure | Count |
|---|---|
| Candidate entries examined | 426 |
| `usable: true` (both files fetch, parse, are real dbt artifacts, >0 model nodes, not a duplicate) | **324** |
| ...of those, inside dbt-check's supported schema matrix (manifest v10/v11/v12 + catalog v1) | **254** |
| ...of those, also with manifest↔catalog skew ≤ 10 min | **238** |
| Distinct *identifiable organization* projects (not vendor packages, not tooling fixtures, not tutorials) | **17** (12 within the supported schema matrix) |

The corpus is **large but heavily biased**: 43% of usable entries are vendor dbt packages,
and Fivetran alone is 34% of the whole corpus. See "Bias" below before drawing conclusions
about "drift in the wild."

---

## Route definitions

- **Route A — hosted dbt docs site.** `dbt docs generate` output published as a static site
  that serves `manifest.json` and `catalog.json` at the site root (or a subpath).
  206 usable entries. `route: "A_hosted_docs_site"`.
- **Route B — artifacts committed to a public GitHub repo**, fetched via
  `raw.githubusercontent.com/<repo>/<branch>/<dir>/{manifest,catalog}.json`.
  118 usable entries. `route: "B_github_repo"`.

Where a project was reachable both ways, Route A was kept and the Route B twin dropped as a
byte-identical duplicate.

---

## Search angles, in the order run, with yield

### 1. GitHub code search on `catalog.json` — low yield on its own
```bash
gh search code "dbt_schema_version <term>" --filename=catalog.json --limit 100 \
  --json repository,path
```
Run across ~35 query slices to defeat the result cap: by adapter (`snowflake`, `bigquery`,
`databricks`, `postgres`, `duckdb`, `redshift`, `spark`, `athena`, `trino`, `clickhouse`,
`synapse`, `sqlserver`, `fabric`, `materialize`), by `dbt_version` prefix (`1.0.`–`1.10.`,
`0.20.`, `0.21.`), and by generic keys (`generated_at`, `invocation_id`, `project_id`,
`catalog.v1.json`).

**Yield: 57 distinct repos.** This angle alone would have produced a corpus ~4x too small.

### 2. Git-tree sweep over a wide repo pool — the highest-yield angle
Built a pool of 2,251 repos from:
- full org listings for `fivetran`, `dbt-labs`, `calogica`, `Snowflake-Labs`, `snowplow`, `tuva-health`
- `search/repositories?q=topic:dbt` and `topic:dbt-project` (5 + 3 pages)
- name searches: `dbt docs`, `dbt analytics`, `dbt warehouse`, `dbt-docs`, `analytics-engineering`
- every repo from angle 1

Then one `GET /repos/{repo}/git/trees/HEAD?recursive=1` per repo (8 threads), looking for any
directory containing **both** `manifest.json` and `catalog.json`.

**Yield: 312 (repo, dir) pairs across 210 repos.** This found **153 repos that code search
missed** — and code search found **zero** repos the tree sweep missed. Code search is a
strict subset here.

### 3. Web search for hosted docs sites + GitHub Pages API resolution
Run as a separate search pass. Web search alone found only the first handful. The lever that
produced most of Route A was: find a candidate repo, then ask GitHub for its *real* site URL
rather than guessing `org.github.io/repo`:
```bash
gh api repos/OWNER/REPO/pages --jq .html_url
```
This catches custom domains that URL-guessing cannot (`matthewsenick.com/dbt-orphan`,
`michalkolacek.xyz/mds4all-elt`, `tylerrouze.com/gh-pages-dbt-docs`,
`raulingaverage.dev/dbt-Docs-Tutorial-Portal`).

**Yield: 205 candidate site base URLs.**

### 4. Pages API sweep over the whole repo pool
Ran `GET /repos/{repo}/pages` across all 2,251 pooled repos → 323 repos with Pages enabled,
136 not already covered. Each was probed with a **1,200-byte HTTP Range request** on both
`manifest.json` and `catalog.json`, checking for the `schemas.getdbt.com/dbt/` signature —
cheap enough to test hundreds of sites without downloading them.

**Yield: 19 additional sites**, including `basedosdados`, `tuva-health/tuva-core`,
`ccao-data`-adjacent projects.

This angle matters because **GitHub code search only indexes the default branch**, so any
project publishing docs to a `gh-pages` branch is invisible to angles 1 and 2.

### 5. CI-workflow code search — best angle for finding *real* organizations
```bash
gh search code "dbt docs generate <term>" --extension=yml  --limit 100
gh search code "dbt docs generate <term>" --extension=yaml --limit 100
```
with `<term>` ∈ {∅, peaceiris, pages, netlify, s3, deploy, target, artifact, publish,
cloudflare, vercel, azure, docs_serve, static} plus unscoped variants for `gh-pages`,
`githubpages`, `dbt-docs`. 152 repos, 140 new. Each then went through the Pages API + probe,
and through the tree sweep.

**Yield: 10 sites + 11 tree hits.** Small in count but disproportionately *real*: Cook County
Assessor's Office (`ccao-data/data-architecture`, 857 models on Athena), MIT Sustainability,
Gnosis Chain, Data for Good France, `basedosdados`.

---

## Verification procedure (`verify_all.py`)

For each candidate, both URLs were fetched **once**, streamed to a temp file, parsed with
`json.load`, then discarded. Recorded per file: HTTP status, exact byte count,
`Content-Type`, `metadata.dbt_schema_version`, `metadata.dbt_version`,
`metadata.generated_at`, `metadata.adapter_type`, `metadata.project_name`, `len(nodes)`,
`len(sources)`. Skew = `abs(catalog.generated_at - manifest.generated_at)` in seconds.
Files over 50 MB are flagged with a `note` and were not re-fetched.

An entry is `usable: false` when any of:
- either URL is non-200, or the body is not valid JSON / not a JSON object
- either file lacks `metadata.dbt_schema_version` (not a dbt artifact)
- the manifest has 0 model nodes
- the catalog has 0 model nodes (split in the `reason` into *stub catalog* — 0 nodes **and**
  0 sources, meaning `dbt docs generate` ran with no warehouse introspection — versus
  *sources-only*, where sources were introspected but no models were)
- the pair is a **byte-identical duplicate** of another entry (same manifest `generated_at`
  + same manifest and catalog byte counts). `duplicate_of` names the kept entry.
- the pair sits under `dbt_packages/` or `dbt_modules/`, i.e. a vendored copy of an upstream
  package's own artifacts rather than an independent project

`schema_supported` is a **separate** flag, not folded into `usable`: it is true only when the
manifest is v10/v11/v12 **and** the catalog is v1, which is the matrix
dbt-check v0 enforces (outside it, the CLI hard-fails).
70 usable pairs fall outside it and cannot be run through dbt-check v0 as-is.

### Spot-check of the pipeline
Three entries (`ccao-data/data-architecture`, `coderxio/sagerx`, `openedx/aspects-dbt`) were
independently re-fetched with plain `curl` + `json.load` and compared field-by-field against
`corpus-candidates.json`: byte counts, node counts and `generated_at` matched exactly on all three.
The rejection gates were also confirmed against live data rather than trusted — e.g.
`mit-sustainability/basin`'s catalog was re-fetched and is genuinely a 326-byte stub with 0
nodes and 0 sources.

---

## Bias — read this before using the corpus

| Category | Usable entries | Share |
|---|---|---|
| `vendor_package` (a dbt package sold/published by a vendor) | 139 | 43% |
| `real_project_individual` (one person's own project/portfolio) | 86 | 27% |
| `tooling_fixture` (test fixture inside a dbt tool's repo) | 54 | 17% |
| `demo_tutorial` (`project_name` is `jaffle_shop` or equivalent) | 28 | 9% |
| `real_project_org` (an identifiable organization's own analytics project) | **17** | **5%** |

- **Fivetran is 111 of 324 entries (34%).** Every Fivetran package publishes `docs/` to
  gh-pages from its own CI. Their `metadata.project_name` is literally
  `*_integration_tests` — these are integration-test projects run against Postgres, not
  production warehouses. Treating them as 111 independent observations would badly overweight
  one vendor's CI conventions.
- `demo_tutorial` was assigned from evidence, not repo names: `metadata.project_name ∈
  {jaffle_shop, jaffle_shop_duckdb, my_new_project, dbt_project}`. 26 entries are literally
  the dbt tutorial project.
- **The honest number for "real company projects" is 17, not 324** — and only 12 of those are
  within dbt-check v0's supported schema matrix. If the survey needs production projects run
  by organizations, the reachable public population is genuinely small. Everything above that
  count is vendor CI output, tool fixtures, tutorials, or individual portfolios.

## Other distributions (324 usable)

- **Manifest schema:** v12 221, v11 23, v10 11 (255 manifests in the supported range) · v7 15,
  v9 10, v1 9, v4 8, v5 8, v6 5, v3 5, v8 5, v2 3, plus one non-canonical
  `…/manifest/v11/manifest.json` URL form. **Catalog schema:** v1 322, plus one `v11` and one
  non-canonical `…/catalog/v1/catalog.json` form — parsers should not assume the schema URL
  is exactly `…/catalog/v1.json`. `schema_supported` is 254 rather than 255 because one entry
  (`Cocoon-Data-Transformation/cocoon @ …/dbt_shopify/target`) pairs a v12 manifest with a
  **v11 catalog** — a mismatched pair that would fail the catalog-v1 check.
- **Skew (catalog vs manifest `generated_at`):** min 0.0s, median 5.4s, p90 222s, max
  40,880,531s (473 days). Buckets: <10s 214 · 10–60s 69 · 1–10min 17 · 10min–1h 5 · 1h–1d 2 ·
  **>1d 17**. The 17 stale pairs describe two different moments and any drift finding from
  them is unreliable — filter on `skew_seconds`. Worst offenders: `matsonj/nba-monte-carlo`
  (473d) and 10 separate `Cocoon-Data-Transformation/cocoon` sub-projects (25–459d).
- **Adapter:** postgres 133, snowflake 74, bigquery 49, duckdb 35, databricks 6, redshift 4,
  sqlserver 3, clickhouse 2, fabric 2, trino 2, athena/spark/mysql/starrocks/oracle 1 each,
  absent 9. Postgres dominance is a Fivetran artifact, not a market signal.
- **Scale:** manifest model nodes min 1, median 57, p90 237, max 7,705. The largest entries are
  `dagster-io/supercharged-dbt-docs` (7,705 — a synthetic stress-test fixture, not a real
  project), `tuva-health/tuva-core` (2,144), `piyushlnu/dbt-docs-test` (1,884),
  `ohdsi/dbt-synthea` (1,717), `ccao-data/data-architecture` (857), Cal-ITP (854). Only three
  of the six largest are real projects — the corpus thins out fast above ~800 models.

---

## What I could NOT find / systematic obstacles

1. **GitHub code search only indexes default branches**, so every project publishing docs to a
   `gh-pages` branch is invisible to it. Only the Pages API sweep (angle 4) reaches those.
   Any corpus built from code search alone is silently truncated.
2. **Code search is a strict subset of the tree sweep here** — it surfaced 57 of the 210 repos
   the tree sweep found and added none of its own. Do not rely on it as the primary angle.
3. **`gh search code` silently returns 0 results for quoted multi-term queries.**
   `'"dbt docs generate" actions-gh-pages'` returns nothing while
   `'dbt docs generate'` returns hits. Every phrase query has to be decomposed into
   space-separated AND terms or the angle looks dead when it isn't.
4. **GitLab-hosted dbt docs are unreachable.** `https://dbt.gitlabdata.com` and
   `https://gitlab-data.gitlab.io/analytics` — GitLab's own public dbt docs, one of the
   largest public dbt projects in existence — return **403 to all programmatic clients**
   (tried default and browser user agents, root and artifact paths). Human-browsable,
   not fetchable. This is the single biggest known gap in the corpus.
5. **Newer dbt-docs bundles inline the artifacts into `index.html`** instead of serving
   separate JSON files, so the site renders but there is nothing to fetch. Confirmed on
   `gooddollar.github.io/data-team` and `tzelleke.github.io/nobel-prize-report`. As this
   packaging spreads, Route A will get harder, not easier.
6. **8.4% of otherwise-valid public dbt docs sites ship an empty catalog** (30 of the 359
   candidates whose files fetched and parsed cleanly). 25 of those 30 are stubs of 228–327
   bytes with no sources either; the other 5 introspected sources but no models. The docs site exists, the manifest is complete, and no warehouse was ever
   introspected. Notable casualties: `mit-sustainability/basin`, `gnosischain/dbt-cerebro`
   (96 sources, 0 models), `kzzzr/mybi-dbt-showcase`, `beyond-all-reason/data-processing`.
7. **Not reachable at all:** dbt Cloud–hosted docs (auth required), any warehouse-internal
   docs site (e.g. NAV's real catalog lives at `dbt.intern.nav.no`), and dbt package hub
   entries that ship no generated docs.
8. Some repos publish docs but were rejected on HTML-404 (the site 200s on the base URL and
   returns an HTML 404 page for the JSON), including `dbt-labs/jaffle_shop`,
   `dbt-labs/dbt-utils`, `dbt-labs/dbt-project-evaluator`, `velir/dbt-ga4`,
   `elementary-data/dbt-data-reliability`, and several `cagov/*` repos. The Range-probe
   signature check (looking for `schemas.getdbt.com/dbt/`) is what distinguishes these from
   real hits; a bare HTTP 200 check would have produced dozens of false positives.

## Pipeline scripts (referenced for method; not included in this directory)

The corpus was built by a small script pipeline. The scripts and their intermediate
output are not part of this evidence set — `corpus-candidates.json` is the verifiable
output — but the pipeline stages are listed so the method is reconstructible.

| File | Purpose |
|---|---|
| `harvest.sh` | angle 1 — sliced `gh search code` over `catalog.json` |
| `scan_fast.py` | angle 2 — parallel git-tree sweep, finds dirs holding both files |
| `scan_sha.py` | re-scan of hit repos capturing blob SHAs + repo metadata |
| `pages.py` | `GET /repos/{repo}/pages` → real site URL (handles custom domains) |
| `probe.py` | cheap 1,200-byte Range probe for the dbt artifact signature |
| `merge.py` | merges Route A sites onto Route B repos into one entry per project |
| `verify_all.py` | fetch-once + parse + skew; writes the raw verified records |
| `classify.py` | category assignment (vendor / tooling / org / individual / tutorial) |
| `assemble.py` | dedupe, reason text, final `candidates.json` |
| `raw/` | intermediate search output, retained with the pipeline so the run is auditable |

Rebuild order: `harvest.sh` → `scan_fast.py` → `scan_sha.py` → `pages.py` → `probe.py` →
`merge.py` → `verify_all.py` → `assemble.py`. Requires `gh auth token` with `repo` scope.
