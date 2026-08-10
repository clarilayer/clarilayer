# dbt-check corpus survey — run log

Measurement of the **published** `clarilayer@0.2.1` CLI across the public dbt artifact corpus.
Date: 2026-08-07. This file records what ran, what failed, what was excluded and why.
It contains no conclusions about what the numbers mean.

## What ran

- CLI: `npm i clarilayer@0.2.1` into a clean working directory, invoked as
  `./node_modules/.bin/clarilayer dbt-check --project-dir <dir> --json`.
  `--version` prints `0.2.1`. The drift logic was **not** reimplemented; every number
  below is read out of the tool's own `--json` report.
- Driver: a small Python driver script (`driver.py`, 5 worker threads). Per project: `curl` both
  artifacts into `run/<slug>/target/`, run the CLI, capture stdout / stderr / exit code, gzip
  the report to `reports/<slug>.json.gz`, then `rm -rf run/<slug>` before the next project.
- Aggregation: an analysis script (`analyze.py`) producing `per_project.json`, `strata.json`,
  and a per-finding extract `phantom_findings_org.json`.
- **Each URL was fetched exactly once.** No retries, no re-fetch on failure. One deliberate
  out-of-sweep verification fetch is disclosed under "Spot-verification" below.

## Population

`corpus-candidates.json` holds 426 entries. All 426 appear in `per_project.json`.

| Population | n | Treatment |
|---|---|---|
| `usable: true` | 324 | run |
| non-usable, rejected for a stub / model-less catalog | 30 | run, tagged `corpus_population: empty_catalog` |
| non-usable for any other reason (duplicate, vendored under `dbt_packages/`, not a dbt artifact, unparseable) | 72 | **not run** — recorded with the corpus's rejection text |

354 projects were run. 277 produced a report (exit 0); 77 were refused by the CLI (exit 2).

## Failures

**Zero download failures.** All 708 fetches returned HTTP 200 with a non-empty body.
Zero CLI timeouts, zero crashes, zero unparseable `--json` output.

The only non-zero exits were the CLI's own schema gate (exit 2, 77 projects), which is the
documented refusal path, not a failure.

## Gates applied

Gate precedence for `included_in_headline` is first-match:
`unsupported_schema` → `empty_catalog` → `no_models` → `stale`.
`strata.json` also carries `raw_gate_flags` with each condition counted independently,
because the conditions overlap.

| Gate | Projects excluded | How detected |
|---|---|---|
| Unsupported schema | **77** | CLI exit 2 |
| Empty / stub catalog | **24** | tool-native: `coverage.models.built == 0` with non-ephemeral models > 0 |
| Stale pair | **14** | tool's own `artifact_skew.stale` (its 3600 s threshold) |
| Manifest with 0 model nodes | **1** | tool: `coverage.models.total == 0` |
| Never run (corpus reject) | **72** | corpus `reason` |
| **Headline stratum** | **239 remain** | |

Notes on each gate:

- **Unsupported schema (77).** Manifest versions refused: v7 ×15, v9 ×12, v1 ×10, v4 ×9,
  v5 ×8, v3 ×6, v8 ×6, v6 ×5, v2 ×3, v20 ×1, plus 2 non-canonical/mismatched cases (below).
  The set refused matches the corpus's own `schema_supported` flag exactly — 0 disagreements
  in either direction.
- **Stale (14 excluded under precedence; 16 flagged by the tool).** The tool flagged 16 of the
  277 reports `stale: true`; 2 of those are also empty-catalog and are counted under that gate.
  A further 6 stale corpus entries were refused on schema and 2 were never run, so 24 corpus
  entries have skew > 3600 s in total. **The tool's `skew_seconds` agreed with the corpus's
  independently computed skew on all 277 reports** (no pair differed by more than 2 s), which
  also means no docs site was redeployed between the corpus build and this run.
  **No `real_project_org` project is stale.**
- **Empty / stub catalog (24).** 23 came from the corpus's stub population; **1 more
  (`kgmcquate/dbt-testgen`) was flagged by the tool but not by the corpus** — see
  "Corpus caveat" below. Their distribution: `real_project_individual` 14,
  `tooling_fixture` 4, `real_project_org` 2 (`gnosischain/dbt-cerebro`,
  `mit-sustainability/basin`), `demo_tutorial` 2, `vendor_package` 1
  (`fivetran/dbt_dynamics_365_crm`).

## What the CLI does with an empty catalog (measured, not assumed)

It does **not** report zero drift. For all 23 stub-catalog projects it reported every
non-ephemeral model as `model_never_built` — e.g. `gnosischain/dbt-cerebro` returns 1,280
`model_never_built` findings out of 1,280 models, `mit-sustainability/basin` 45 of 45.
`hollow_description` still fires (it needs no warehouse side), so these reports are non-empty.
The condition is self-announcing in the report as `coverage.models.built == 0`, which is what
this survey gates on.

## Odd artifacts encountered

1. `Snowflake-Labs/dbt_constraints` ships **manifest schema v20**, i.e. *newer* than the
   v10/v11/v12 the CLI supports. The CLI refuses it with its "update the clarilayer CLI if
   your dbt is newer than it" message. This is the only forward-incompatible refusal in the
   corpus.
2. `esagduyu/labrat @ tests/fixtures/sample_dbt_project` declares
   `https://schemas.getdbt.com/dbt/manifest/v11/manifest.json` — a non-canonical URL form.
   The CLI's version regex requires `/{artifact}/v{N}.json$` and refuses it as
   "an unrecognized schema version". The version *is* v11, which is supported; only the URL
   shape differs. Flagged as a possible parser-robustness gap; it is a tooling fixture, and
   whether dbt ever emits this form is not established here.
3. `Cocoon-Data-Transformation/cocoon @ .../dbt_shopify/target` has a **catalog.json whose
   `dbt_schema_version` says `manifest/v11.json`**. The CLI refuses it and names the problem
   precisely ("catalog.json uses an unrecognized schema version"). This is the CLI checking
   artifact *kind*, not just the version number — correct behaviour on a genuinely
   malformed pair.
4. `kgmcquate/dbt-testgen` parses fine and exits 0 with a completely empty report: the
   manifest has 19 nodes but **0 with `resource_type == "model"`**. Recorded as
   `no_models`, excluded from the headline.

## Corpus caveat found while running

The corpus method doc (`corpus-method.md`) states that an entry is rejected when "the manifest
has 0 model nodes" / "the catalog has 0 model nodes", but the corpus verifier (`verify_all.py`
line 35) records
`len(d.get("nodes") or {})` — **all** resource types, not models. So the corpus's node counts
and its stub-catalog gate are all-node counts. This is why `kgmcquate/dbt-testgen`
(19 nodes, 0 models) passed the corpus's `usable` gate. The survey therefore uses the
tool-native `coverage.models.*` numbers throughout rather than the corpus's node counts.

## Spot-verification (one deliberate out-of-sweep fetch)

To avoid reporting findings on the tool's word alone, `DataBusinessGmbH/dbt-docs`
(826 KB + 78 KB, the smallest org project carrying a phantom) was re-fetched once after the
sweep and inspected by hand. Its model `src_acdoca` declares columns `filename` and
`filerow`; the catalog's actual columns include `FILENAME` and `FILE_ROW`. Under the CLI's
normalization (trim, strip quotes/backticks, lowercase) `filename` matches `FILENAME`, while
`filerow` ≠ `file_row`. **The phantom finding is correct**, and `closest_actual: "FILE_ROW"`
is the right rename candidate. The artifacts were deleted after the check.
This is one project out of 239; it is not a false-positive audit.

## Cost

| Measure | Value |
|---|---|
| Sweep wall time (354 projects, 5 workers) | **51.9 s** |
| Total machine time incl. install, smoke test, aggregation, verification | ≈ 3 min |
| Fetches | 708 in the sweep (+2 smoke test, +2 verification) |
| Bytes on the wire (curl `size_download`, gzip in transit) | **60.2 MB** |
| Uncompressed JSON payload written to disk | **637.3 MB** (peak on-disk ≪ that; deleted per project) |
| Artifacts retained | none — only the 277 gzipped JSON reports (1.2 MB total) |
| CLI runtime per project | median 0.07 s, p90 0.11 s, max 0.37 s (572 models / 14.5 MB manifest) |

## Outputs

Included in this directory:

- `per_project.json` — 426 records (all corpus entries), with `included_in_headline`
  and `headline_reason` on every one.
- `strata.json` — per-category aggregates. **No blended cross-category figure is
  computed anywhere in this file.**

Produced by the run but not included here:

- `phantom_findings_org.json` — 311 full phantom-column records from the
  `real_project_org` stratum, each carrying `model`, `column`, `closest_actual`, `yaml_path`,
  and the adapter the catalog was produced on. The 79 of them that were hand-adjudicated
  appear with full evidence in `fp_audit.json`.
- `reports/*.json.gz` — the 277 raw CLI reports, unmodified.
- `driver.py`, `analyze.py`, `raw_results.json` — the run itself, re-runnable.

## Known limits of this measurement

- The `real_project_org` stratum is n=12 in the headline. Every distribution over it is a
  12-point sample; `DataBusinessGmbH/dbt-docs` contributes a share of 1.000 on a denominator
  of **one** documented model, which pulls the maximum to 1.0 and is not a meaningful rate.
- `share_documented_models_with_phantom` uses the tool's `coverage.models.documented`, which
  counts only models that are both **built** and carry ≥1 declared column. Models missing
  from the catalog are therefore not in that denominator.
- The adapter-breadth signal collected for the false-positive audit does **not** discriminate
  (see `strata.json → _method.adapter_caveat`): 114 of the 277 projects that ran have exactly
  7 distinct `<adapter>__` macro prefixes in their manifest, because dbt_utils and dbt-core
  global macros ship them into every manifest. What *is* reliable is
  `catalog_run_adapter` — the single adapter each catalog was generated against, which is
  single by construction since `dbt docs generate` targets one profile.
- No finding was audited for correctness beyond the single spot-check above.
