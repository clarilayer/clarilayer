# dbt drift survey — evidence set (2026-08-07)

This directory is the evidence set for a survey of docs-vs-warehouse drift across public
dbt projects, run on 2026-08-07 with the published `clarilayer@0.2.1` CLI (`dbt-check`).
It is published so the survey's numbers can be checked independently: every figure quoted
from the survey traces to a record in these files.

## What was measured

For every public dbt project where both `manifest.json` and `catalog.json` are fetchable
without authentication, `clarilayer dbt-check --json` was run on the pair, and its report
was recorded as-is. The drift logic was not reimplemented; all numbers come from the
tool's own JSON output. Each artifact URL was fetched exactly once (`run_log.md` discloses
the two out-of-sweep verification fetches).

## Corpus construction (summary — full method in `corpus-method.md`)

426 candidate artifact pairs were found via five search angles (GitHub code search,
a git-tree sweep over 2,251 pooled repos, web search for hosted docs sites, a GitHub
Pages API sweep with cheap Range-request probes, and CI-workflow code search). Every
candidate was verified by actually fetching and parsing both files — nothing was inferred
from filenames or search snippets. 324 pairs are `usable: true`; the rest are recorded
with an explicit rejection reason (stub catalog, duplicate, vendored copy, not a dbt
artifact, unparseable).

## Gates applied to the run (details in `run_log.md`)

354 projects were run (the 324 usable pairs plus the 30 stub-catalog rejects, for
completeness). Exclusion from the headline stratum is first-match:

| Gate | Excluded | Detected by |
|---|---:|---|
| Unsupported artifact schema | 77 | the CLI's own refusal (exit 2) |
| Empty / stub catalog | 24 | tool-native `coverage.models.built == 0` |
| Manifest with 0 model nodes | 1 | tool-native `coverage.models.total == 0` |
| Stale manifest↔catalog pair | 14 | the tool's `artifact_skew.stale` (3600 s threshold) |

239 projects remain in the headline stratum overall.

## Why the results are stratified

The corpus is heavily biased: 43% of usable entries are vendor dbt packages, and Fivetran
alone is 34% of the whole corpus — CI integration-test projects run against Postgres, not
production warehouses. A blended cross-corpus figure would mostly describe one vendor's CI
conventions, so no blended figure is computed anywhere in these files; `strata.json` reports
each category separately.

The population of reachable *organizational production* projects is small: **17** distinct
identifiable-organization projects have usable public artifact pairs, and **12** of those
remain in the headline stratum after the schema gate. Headline claims about "real company
projects" rest on that n=12 stratum, not on the 324.

One project in that stratum, `lovelight-code/dw-docs`, is excluded from headline
false-positive figures: it publishes artifacts but no project source, so its findings
cannot be attributed to a cause from public evidence — all 7 of its sampled findings
adjudicated as `undetermined`, and the false-positive bound is therefore quoted both with
and without it (see `fp_audit.md`, §5, for the full discussion).

## False-positive audit

79 of the 311 `phantom_column` findings in the organizational stratum (25.4%) were
hand-adjudicated against the projects' own SQL, compiled code, catalogs, and public repo
YAML, across two seeded, stratified sampling rounds — plus three mechanism checks run over
all 311 findings and an adversarial census of every finding that could mechanically be a
false positive. Result: **0 false positives in 79**; 72 confirmed drift, 7 undetermined
(all in `lovelight`). Method, seeds, and per-stratum bounds are in `fp_audit.md`;
per-finding verdicts with evidence are in `fp_audit.json`.

## Files

| File | Contents |
|---|---|
| `corpus-candidates.json` | all 426 candidate entries: URLs, byte counts, schema versions, skew, category, `usable` flag and rejection reasons |
| `corpus-method.md` | how the corpus was built: search angles with yields, verification procedure, bias analysis, known gaps |
| `per_project.json` | one record per corpus entry (426): CLI exit code, coverage, findings by kind, gates, `included_in_headline` |
| `strata.json` | per-category aggregates over the headline stratum; no blended figure |
| `run_log.md` | what ran, what failed, gate counts, odd artifacts encountered, cost |
| `fp_audit.md` | false-positive adjudication: sample design, results, hypothesis tests, adversarial census |
| `fp_audit.json` | the 79 per-finding verdicts with evidence, plus a `_summary` block |

## Reproduce

```bash
# for any project in corpus-candidates.json, download its manifest.json + catalog.json into ./target/, then:
npx clarilayer@0.2.1 dbt-check --json
```

The per-project records in `per_project.json` carry the exact artifact URLs used. Note
that hosted docs sites can be redeployed at any time; `generated_at` and byte counts in
`corpus-candidates.json` identify the exact artifact versions this survey measured.
