# dbt-check phantom-column findings — false-positive adjudication

**Population.** The 311 `phantom_column` findings in the `real_project_org` stratum
(the `phantom_findings_org.json` extract produced by the survey run — see `run_log.md`),
spread over 9 projects.

**Sample.** 79 findings (25.4% of the population) across two rounds, stratified, fixed seeds.

- **Round 1** — seed `20260807`, n = 60, all 9 projects.
- **Round 2** — seed `20260808`, n = 19, `abagdi` and `calitp` only: the two strata whose
  per-stratum bounds drove round 1's design-based figure. Disjoint from round 1 by
  construction.

**Headline.** **0 false positives in 79.** 72 confirmed drift, 7 undetermined, 0 in any
false-positive class. The three hypotheses the survey flagged as the leading
false-positive risks — case/quoting, BigQuery nested fields, sources mistaken for models —
were each tested against **all 311** findings, not just the sample, and each came back
**zero**. A fourth, adversarial census (§7) enumerates every finding that *could*
mechanically be a false positive and adjudicates the 8 strongest candidates: all 8 are
real drift.

**Design-based 95% upper bound: 24.8% → 14.8%**, and the residual is no longer in the two
big projects — `abagdi` + `calitp` fell from 24.3% to **11.9%**. What remains is
concentrated almost entirely in `lovelight`, the one stratum that is genuinely
unresolvable from public evidence.

---

## 1. Sample design (reproducible)

### Round 1 — seed `20260807`

Script: `sample.py` (audit pipeline, not included here); output `sample.json`.
Per project the pool is sorted by `(model_unique_id, column)` and drawn with
`random.Random(f"{seed}|{project}").sample(range(N), n)` — no replacement.

Census (n = N) for the two projects the survey flagged as genuinely single-adapter,
because the leading false-positive hypothesis cannot apply to them, plus the one
single-finding project. Proportional-ish elsewhere, with a floor of 3 so every project
contributes.

| project | adapter | N | n | weight | note |
|---|---|---:|---:|---:|---|
| abagdi-allvuesystems/dbt-docs-site @ docs | snowflake | 112 | 10 | 11.20 | |
| dbt-docs.calitp.org | bigquery | 106 | 10 | 10.60 | |
| lovelight-code/dw-docs | redshift | 42 | 7 | 6.00 | |
| chienazazaz/sado_analytics_services @ prod | bigquery | 20 | 5 | 4.00 | |
| ccao-data/data-architecture | athena | 11 | 11 | 1.00 | **census** (single-adapter) |
| coderxio/sagerx | postgres | 9 | 9 | 1.00 | **census** (single-adapter) |
| openedx/aspects-dbt | clickhouse | 6 | 4 | 1.50 | |
| thesis/mezo-dbt | bigquery | 4 | 3 | 1.33 | |
| DataBusinessGmbH/dbt-docs @ &lt;root&gt; | snowflake | 1 | 1 | 1.00 | **census** |
| **total** | | **311** | **60** | | |

### Round 2 — seed `20260808`, `abagdi` and `calitp` only

Script: `sample_r2.py`; output `sample_r2.json`. Every round-1
`finding_id` is removed from each pool **before** drawing, so the two rounds are disjoint
by construction (asserted in the script, not just intended).

Round 2 sub-stratifies the two target projects, for two reasons:

| sub-stratum | definition | N | n (r1) | n (r2) | n total |
|---|---|---:|---:|---:|---:|
| `A1` | abagdi / `openair_utilization_by_employee` — the pathological commented-out-projection model characterised in round 1 | 25 | 3 | **1** | 4 |
| `A2` | abagdi / **all other 18 models** — deliberately over-weighted | 87 | 7 | **8** | 15 |
| `C1` | calitp / trailing-comma declared names (the malformed-name class) | 12 | 1 | **3** | 4 |
| `C2` | calitp / **everything else**, 40 distinct models | 94 | 9 | **7** | 16 |

`A1` is deliberately *under*-drawn so the abagdi stratum is not carried by one pathological
file: 15 of abagdi's 19 draws are now from other models, covering 9 distinct models.
`C1`/`C2` are split so the non-malformed calitp findings can be reported on their own.

For the bound, each sub-stratum is treated as its own stratum, conditioning on the
achieved allocation. That is valid here: within a sub-stratum, the round-1 draws are an SRS
of that sub-stratum given its size, and the round-2 draws are an SRS of the remainder —
i.e. sampling without replacement, which is what the hypergeometric bound assumes.

### Evidence used

Each project's `manifest.json` and `catalog.json` were **re-fetched** into a local
`artifacts/` directory. All 18 files came back byte-identical in size to the corpus record,
and every `generated_at` pair matched `per_project.json` exactly — so the artifacts
adjudicated are the artifacts the survey ran on.

Adjudication used, in order: the model's own `raw_code` (the project's SQL, embedded
verbatim by dbt at parse time), its `compiled_code` where the projection is macro- or
star-generated, the catalog entries of the model's direct star sources and full ancestry,
and — for the load-bearing calls — the project's YAML fetched from its public repo.
Repo YAML was pulled and quoted for `coderxio/sagerx`, `ccao-data/data-architecture` and
`cal-itp/data-infra`.

---

## 2. Results

### Combined sample (n = 79 = 60 + 19)

| bucket | round 1 | round 2 | total | share of sample |
|---|---:|---:|---:|---:|
| `confirmed_drift` | 53 | 19 | **72** | 91.1% |
| `false_positive_adapter_conditional` | 0 | 0 | **0** | 0.0% |
| `false_positive_tool` | 0 | 0 | **0** | 0.0% |
| `false_positive_other` | 0 | 0 | **0** | 0.0% |
| `undetermined` | 7 | 0 | **7** | 8.9% |

Design-weighted to the population: **269 confirmed drift (86.5%), 42 undetermined
(13.5%), 0 false positive.** Round 2 did not move the weighted point estimate — it was
never meant to; it was meant to move the *bound*.

### The false-positive rate, stated plainly

**0 false positives out of 79 adjudicated findings (25.4% of the population).**

| reading | round 1 (n=60) | **round 1+2 (n=79)** |
|---|---|---|
| Unweighted exact (Clopper-Pearson) 95% CI | [0%, 4.9%] | **[0%, 3.7%]** |
| Over the adjudicable subset only | 0/53 → ≤ 5.5% | 0/72 → ≤ 4.1% |
| **Design-based 95% upper bound** | **≤ 77/311 = 24.8%** | **≤ 46/311 = 14.8%** |
| …of which `abagdi` + `calitp` | 53/218 = 24.3% | **26/218 = 11.9%** |
| …strict on `lovelight` (see below) | — | ≤ 75/311 = 24.1% |
| …excluding `lovelight` entirely | — | **≤ 33/269 = 12.3%** |

Two things did the work. Round 2 quadrupled the draw in the two big strata, and the
at-risk census (§7) caps each stratum's possible false-positive count at the number of
findings that could mechanically be false at all — 15 of 112 in `abagdi`, 59 of 106 in
`calitp`.

**On `lovelight`, be strict.** Its 7 draws all came back `undetermined`, which is *no*
evidence against false positives there. The 14.8% figure leniently counts them as not-FP.
Read strictly — treating all 42 lovelight findings as unresolved — the bound is 24.1%,
and **every point of the difference is lovelight**. That is the honest summary of what
round 2 achieved: it did not shrink total uncertainty so much as *relocate* it, out of the
two big projects and into the one stratum where it genuinely belongs.

### Per-stratum (combined)

| stratum | N | n | drift | undet | FP | at-risk (of N) | 95% bound |
|---|---:|---:|---:|---:|---:|---:|---:|
| abagdi `A2` other models | 87 | 15 | 15 | 0 | 0 | 15 | ≤ 8 |
| abagdi `A1` openair_uve | 25 | 4 | 4 | 0 | 0 | **0** | **0** |
| calitp `C2` rest | 94 | 16 | 16 | 0 | 0 | 47 | ≤ 13 |
| calitp `C1` trailing-comma | 12 | 4 | 4 | 0 | 0 | 12 | ≤ 5 |
| lovelight-code/dw-docs | 42 | 7 | 0 | **7** | 0 | 42 | ≤ 13 lenient / 42 strict |
| chienazazaz | 20 | 5 | 5 | 0 | 0 | 13 | ≤ 5 |
| ccao-data (census) | 11 | 11 | 11 | 0 | 0 | 2 | **0** |
| coderxio/sagerx (census) | 9 | 9 | 9 | 0 | 0 | 1 | **0** |
| openedx/aspects-dbt | 6 | 4 | 4 | 0 | 0 | 3 | ≤ 2 |
| thesis/mezo-dbt | 4 | 3 | 3 | 0 | 0 | **0** | **0** |
| DataBusinessGmbH (census) | 1 | 1 | 1 | 0 | 0 | 0 | **0** |

`A1` and `mezo` now carry a bound of exactly **0** — not from sampling, but because the
at-risk census proves no finding in either could be a false positive by any mechanism.

### calitp with and without the malformed-name class

A fair question is whether calitp's non-malformed findings hold up on their own once
the 12 trailing-comma cases are set aside. They do:

| | N | n | confirmed drift | FP | 95% bound |
|---|---:|---:|---:|---:|---:|
| calitp, **all** | 106 | 20 | 20 | **0** | ≤ 18 (17.0%) |
| calitp, **trailing-comma class only** (`C1`) | 12 | 4 | 4 | **0** | ≤ 5 |
| calitp, **excluding the malformed class** (`C2`) | 94 | 16 | 16 | **0** | ≤ 13 (13.8%) |

The 16 `C2` draws span 14 distinct models and are ordinary, high-quality drift: renames
(`uza_name` → `primary_uza_name`, `max_state` → `state`), a singular/plural typo
(`transit_data_quality_issue` vs `transit_data_quality_issues`), a column the source has
but the staging model deliberately does not propagate (`api_key` — a secret), and columns
dropped from an explicit projection (`flex_status`, `external_reference_number`).
**Setting the 12 syntax cases aside does not weaken the calitp result at all.**

### abagdi without the pathological model

15 of abagdi's 19 draws are from models other than `openair_utilization_by_employee`,
covering 9 distinct models: `copilot_metrics_report`, `dim_openair_utilization_by_employee`,
`openair_user`, `ps_time_and_charges`, `support_time_and_charges`, `sys_sf_quote`,
`sys_sf_recordtype`, `time_entries`, `fact_customer_survey` (via §7). All 15 are confirmed
drift. **The stratum is not carried by the one pathological file.**

The two census projects carry the strongest statement: **20 of 20 findings on the two
provably single-adapter projects are confirmed drift, with no sampling error at all.**

---

## 3. The three hypotheses

Each was tested over **all 311** findings (`hypotheses.py`,
`h1_control.py`), not only the 60.

### H1 — case / quoting. **Refuted. The normalization works.**

Across all 311 findings, the number whose declared name is present in the model's catalog
entry is:

| relaxation | hits / 311 |
|---|---:|
| exact string | **0** |
| after the tool's own normalization (trim, strip `"`/`` ` ``, lowercase) | **0** |
| case-insensitive compare | **0** |

Not a single phantom is a case artifact. The positive control makes the point better than
the null result does — how many declared columns match **only because** the tool
lowercases, i.e. how many would become phantoms if that normalization were removed:

| project | adapter | declared | matched | exact-string | **case-only** | phantoms |
|---|---|---:|---:|---:|---:|---:|
| abagdi | snowflake | 5,812 | 5,700 | 16 | **5,684** | 112 |
| databusiness | snowflake | 2 | 1 | 0 | **1** | 1 |
| chienazazaz | bigquery | 2,433 | 2,413 | 2,397 | 16 | 20 |
| calitp | bigquery | 6,741 | 6,635 | 6,634 | 1 | 106 |
| lovelight | redshift | 422 | 380 | 380 | 0 | 42 |
| ccao / sagerx / openedx / mezo | — | 4,091 | 4,061 | 4,061 | 0 | 30 |

On Snowflake, 5,684 matches — 99.7% of that project's matching — ride entirely on
case-normalization, and it holds. Redshift folds unquoted identifiers to *lower*, so the
catalog there is already lowercase and no mismatch can arise.

The hand-checked `DataBusinessGmbH` case generalizes exactly as hoped, and it is a clean
two-column demonstration inside one model: the YAML declares `filename` and `filerow`
against a catalog holding `FILENAME` and `FILE_ROW`. `filename` matched (case-only);
`filerow` did not, because the warehouse name has an underscore. That is a real docs typo,
not a normalization failure — and `closest_actual` correctly names `FILE_ROW`.

### H2 — BigQuery nested / struct fields. **Refuted, in both directions.**

| check (all 311) | hits |
|---|---:|
| declared name contains a dot | **0** |
| declared dotted leaf whose parent is in the catalog | **0** |
| declared name is a **parent** whose children appear dotted in the catalog | **0** |

The risky direction was the second one — YAML documents `address`, catalog reports only
`address.city`. It cannot happen, because dbt's BigQuery adapter writes **both** the parent
and the flattened leaves into `catalog.json`. Verified directly on `calitp`
(`stg_gtfs_rt__service_alerts` carries `active_period` *and* `active_period.start`,
`active_period.end`) and on `chienazazaz` (`actions` *and* `actions.action_type`).
Across the corpus: calitp 728 dotted catalog columns, chienazazaz 845, and 0 dotted
declared columns anywhere.

### H3 — sources documented as models. **Refuted.**

All 311 findings sit on a `model.`-prefixed unique_id that is present in `manifest.nodes`
with `resource_type == "model"` and present in `catalog.nodes`. Zero appear in
`manifest.sources`. This is structural, not luck: `engine.js` filters
`node.resource_type === "model"` out of `manifest.nodes` before any comparison, and
`manifest.sources` is a sibling key it never reads.

---

## 4. What the confirmed drift actually is

The 72 confirmed findings are not one thing. Named causes, with the sample counts:

1. **Rename not carried into the docs** (≈20). `triad_name` → `triad_code`;
   `other_ari` → `other_affordability_risk_index`; `uace_cd` → `uace_code`;
   `odometer` → `position_odometer`; `mydec_line_9_other_description` →
   `mydec_line_9_other_change_description`; `usp_preservative` → `preservative`.
2. **Column deleted or never emitted, docs kept** (≈18). `stg_nadac__nadac` still
   documents six price-change fields (`change_type`, `dollar_change`, `first_price`,
   `most_recent_price`, `percent_change`, `price_start_date`) that the simplified model
   no longer computes — the model *description* in the project's own YAML still promises
   them. `stg_transit_database__*` declares a column literally named `time`, with an empty
   description, on 9 different models from one shared YAML file.
3. **Code commented out, docs describe the intent** (7). `chienazazaz` has three models
   with `{# account_name, #}`-style Jinja-commented columns still documented.
   `abagdi/openair_utilization_by_employee` is the extreme case: a 20 KB cleaning
   projection sits entirely inside a `/* … */` block, so the live model is
   `SELECT * FROM man_ube` and the warehouse holds 173 raw Airbyte names like
   `WEEK STARTING 01/19/2025 - RESOURCES - BASE TARGET HOURS`.
4. **Typo in the YAML** (≈3 + 12 population-wide). `clinical_product_compnent_name`
   (missing `o`); `filerow` (missing `_`); `to_name as disease_name` — a whole SQL
   fragment pasted into the `name:` field, verified at line 56 of the project's
   `_classification__models.yml`.
5. **Column dropped mid-transform** (9 of the round-1 60 have the name in an ancestor's
   catalog). `itp_activities` exists on the Airtable source, the staging model's explicit
   projection drops it; `emission_time` exists on `problem_events`, the
   `dim_problem_responses` GROUP BY drops it.
6. **Documented the intermediate name, not the output name** — a class round 2 added.
   `fact_ps_project_metrics_daily` aliases `current_budget_hours`, `current_eac_hours`,
   `current_budget_dollars`, `current_rag_status` inside its `daily_facts` CTE, then the
   final SELECT renames every one of them to `fact_*`. The YAML documents the CTE-internal
   names. Same shape in `stg_ga4__page_engaged_time` (`page_engagement_time` in a CTE →
   `page_engagement_time_msec` in the output) and
   `int_transit_database__transit_data_quality_issues` (`issue_type_key` aliased in a CTE,
   used only as a join key, absent from the final projection).

### The single most valuable finding in the audit

`abagdi/fact_customer_survey` documents `dissatisfaction_category`. The model is a `UNION`:

```sql
    ,NULL as dissatisfacation_category              -- branch 1  (typo: "dissatisfaCAtion")
  UNION
    ,djs.dissatisfaction_reason as dissatisfaction_category   -- branch 2 (correct)
```

SQL takes a `UNION`'s output column names from the **first** branch, so the built column is
`DISSATISFACATION_CATEGORY` — exactly what the catalog holds — and branch 2's correct
spelling is silently discarded. A one-character typo in the first branch renames the
output column, the query still runs, and nothing in the SQL alone reveals it. Only a
docs-vs-warehouse comparison catches this.

### A low-value sub-class worth naming before publishing: malformed declared names

**12 of 311 (3.9%)** of the org-stratum phantoms are declared names carrying a **trailing
comma**, all in `dbt-docs.calitp.org`, all three names (`feed_type,`,
`_config_extract_ts,`, `schedule_url_for_validation,`) repeated across four GTFS-RT
outcome models. Verified in the project's own
`warehouse/models/staging/gtfs/_stg_gtfs.yml`, lines 690-692, which contain literally:

```yaml
      - name: feed_type,
      - name: _config_extract_ts,
      - name: schedule_url_for_validation,
```

…while the same file spells all three correctly at lines 17, 19, 34, 62. So these are
**true** findings — the warehouse has no column named `_config_extract_ts,` — and
`closest_actual` correctly points at `_config_extract_ts`. But they are a YAML-syntax
defect, not a docs-vs-warehouse semantic drift, and one of them accounts for ~4% of the
headline count. Two adjacent one-off cases exist (`to_name as disease_name`, 1 finding),
so the whole "declared name is malformed" class is **13 of 311 = 4.2%**.

This is a reporting-quality note, not a correctness bug. Any figure citing the 311 total
should call this class out separately; it may deserve its own finding kind in the tool.

---

## 5. The 7 undetermined findings — now the whole of the residual uncertainty

All 7 are `lovelight-code/dw-docs`, on three models that are each **exactly**
`select * from {{ ref('ops_contacts' | 'ops_callouts' | 'fin_project_transactions') }}`.

**After round 2, this stratum is the entire story of the remaining uncertainty.** All 42
of lovelight's findings are in the at-risk set (§7b) — the only stratum where that is true —
because their upstreams are not describable at all. Read strictly, lovelight alone accounts
for 42 of the 75-finding strict bound; every other stratum combined contributes 33 over 269
findings (12.3%). If a future pass wants to shrink the bound further, lovelight is the only
place left worth spending effort, and it cannot be shrunk with public evidence — it would
need the project's own dbt source.

Those three upstream relations are **not describable from anything available**: they are
not in `manifest.nodes`, not in `manifest.sources`, not in `manifest.disabled`, and not in
`catalog.json`. And `lovelight-code/dw-docs` is an artifact-only repo — its tree is
`.nojekyll`, `catalog.json`, `manifest.json`, `compiled/`, `run_results.json`,
`index.html`. There is no dbt project source to read. So nothing settles the model's
effective projection, and per the rubric these belong in `undetermined` rather than being
guessed in either direction.

Two things are worth saying about them anyway:

- The findings are **not shown to be false**. The catalog entry for
  `model.lovelight.contacts` is a real Redshift view with 29 columns, and
  `home_phone_full` is genuinely not one of them. The tool's mechanism did nothing wrong;
  the *cause* is simply not attributable from the evidence.
- The project's own SQL argues on the docs' side. Each model carries a
  `comment_on_columns` post-hook whose dict lists the same 42 names the YAML declares,
  and the macro issues `COMMENT ON COLUMN` unconditionally, with no filter against the
  relation. So the project asserts columns the catalog does not show.

**The blind spot this exposes is worth knowing about even though it produced no false
positive here.** `dbt docs generate` does *not* rebuild models — it re-parses the project
and queries the warehouse for whatever relations are deployed. A project whose CI runs
`docs generate` without a preceding `dbt run` yields a catalog describing relations that
may be arbitrarily older than the manifest, while `artifact_skew` reports a few seconds,
because both *artifacts* were written moments apart. The skew check cannot see stale
*warehouse objects*, only stale *files*. `lovelight`'s `run_results.json` confirms its last
recorded invocation was `generate`, not `run`.

No sampled finding was actually caused by this — the one case that looked like it
(`abagdi/openair_utilization_by_employee`, where the phantom names appear verbatim in
the `.sql` file) turned out to be a block comment, i.e. genuine drift — but it is the
most plausible route to a real false positive, and it would be dishonest to publish a
survey of docs-artifact repos without naming it.

---

## 6. Notes on tool behavior observed while adjudicating

Not defects; recorded because they bear on interpreting the findings.

- **`closest_actual` fired on 33 of 79** adjudicated findings and was semantically right on
  essentially all of them (`filerow`→`FILE_ROW`, `uace_cd`→`uace_code`,
  `clinical_product_compnent_name`→`clinical_product_component_name`,
  `transit_data_quality_issue`→`transit_data_quality_issues`). Two are
  *adjacent-but-not-the-rename* — `course_name`→`course_key` and
  `account_name`→`account_id` — which are string-similar but semantically different
  columns. The 0.60 Levenshtein floor also declined some true renames
  (`odometer`→`position_odometer` scores 0.47; `max_state`→`state` scores 0.556, just
  under; `other_ari`→`other_affordability_risk_index` is far below). That is a
  recall/precision trade-off, not an error — though `max_state` landing at 0.556 shows the
  floor is doing real work right at the boundary.
- **Not one adjudicated model contains an adapter conditional.** Across all **47 distinct
  models** adjudicated over both rounds, 0 have `target.type`, `adapter.dispatch`,
  `adapter.type` or `target.name` anywhere in their own `raw_code` or `compiled_code`.
  Walking their `depends_on.macros`, the only macros with such conditionals are package
  macros (dbt-core / dbt_utils), plus one root-project `source` override in `chienazazaz`
  that gates nothing column-shaped. This corroborates the survey's own `adapter_caveat`:
  `adapter_dispatch_prefix_count` does not discriminate project adapter breadth, and
  parsing the root project's model code — which this audit did — shows the
  conditional-column story is simply not present here.
- **41 of 79 findings sit on a non-explicit projection** (`select *`, `.* except(...)`,
  `dbt_utils.union_relations`, macro-generated). 34 of those 41 were still resolvable —
  through the in-file CTE chain, the fully expanded `compiled_code`, or the direct star
  sources' catalog entries. Only the 7 fully opaque pass-throughs resisted.

---

## 7. Adversarial census: hunting the false-positive mechanism directly

A random sample can miss a pocket. So alongside round 2, every one of the **311** findings
was screened for the only mechanism that can produce a false positive: **the model actually
produces the column**, which would mean the catalog is behind the code.

### 7a. The strongest signal — live aliases

`fp_hunt.py` searches each model's **comment-stripped** `raw_code` +
`compiled_code` for `AS <column>`. (Round 1's version of this test was contaminated by
`/* */`, `--` and `{# #}` comments, and by the trailing-comma class matching its own
separator; both are fixed here.)

| | count / 311 |
|---|---:|
| aliased in **live, uncommented** SQL — false-positive candidates | **8** |
| aliased **only inside a comment** — the "code commented out" drift class | 40 |
| trailing-comma class (handled separately) | 12 |

All **8** candidates were then adjudicated individually. **All 8 are confirmed drift:**

| project / model | column | why it is still drift |
|---|---|---|
| abagdi `fact_customer_survey` | `dissatisfaction_category` | `UNION` takes names from branch 1, which misspells it as `dissatisfacation_category` |
| abagdi `fact_ps_project_metrics_daily` | `current_budget_dollars` | CTE alias; final SELECT renames to `fact_budget_dollars` |
| abagdi `fact_ps_project_metrics_daily` | `current_budget_hours` | → `fact_budget_hours` |
| abagdi `fact_ps_project_metrics_daily` | `current_eac_hours` | → `fact_eac_hours` |
| abagdi `fact_ps_project_metrics_daily` | `current_rag_status` | → `fact_rag_status` |
| calitp `int_transit_database__transit_data_quality_issues` | `issue_type_key` | CTE alias used only as a join key; final projection carries `issue_type_name` |
| chienazazaz `stg_ga4__page_engaged_time` | `page_engagement_time` | CTE alias; output is `page_engagement_time_msec` |
| openedx `dim_problem_responses` | `emission_time` | CTE alias; final `GROUP BY` drops it |

**There is no stale-relation pocket.** Every candidate is a CTE-internal alias that gets
renamed or dropped before the output, or a `UNION` first-branch typo. Not one is a case of
the warehouse lagging the code.

### 7b. The widest net — what could be false at all

`residual_risk.py` widens the screen: a finding can only be a false positive if
the model could produce the column by **any** route — the name appearing anywhere in live
SQL, **or** a direct upstream whose catalog carries it, **or** an upstream that is not
describable from the artifacts.

| | count / 311 |
|---|---:|
| **provably cannot be a false positive** | **176 (56.6%)** |
| at risk by some route | 135 (43.4%) |
| — name in live SQL | 84 |
| — a direct upstream has it | 65 |
| — an upstream is not describable | 46 |

At-risk counts per stratum are what tighten the bound in §2: `abagdi` **15 of 112**,
`calitp` **59 of 106**, `mezo` **0 of 4**, and abagdi's `A1` **0 of 25**. 30 of the 135
at-risk findings were individually adjudicated across the two rounds; all 30 are confirmed
drift.

This is a stronger statement than any sample can make on its own, because it is a census
of the mechanism rather than a sample of the outcome.

---

## Files

Included in this directory:

- `fp_audit.json` — **79** per-finding verdicts (each tagged `round: 1` or `round: 2`, and
  round-2 rows carry their `substratum`), with evidence, repo links, star/dynamic
  classification, `closest_actual` assessment and stratum weights, plus a `_summary`
  block carrying every headline number in this report.

Produced by the audit but not included here (the working scripts and re-fetched artifacts):

- `sample.py` + `sample.json` — round-1 design, seed `20260807`.
- `sample_r2.py` + `sample_r2.json` — round-2 design, seed `20260808`, with the
  disjointness assertion.
- `evidence.py`, `hypotheses.py`, `h1_control.py`, `upstream.py`, `verdicts.py`,
  `verdicts_r2.py`, `stats.py`, `stats2.py` — the checks, re-runnable.
- `fp_hunt.py`, `residual_risk.py` — the §7 adversarial census.
  (`alias_test.py` is round 1's comment-contaminated screen, superseded by
  `fp_hunt.py`; kept only so the correction is auditable.)
- `artifacts/` — the 18 re-fetched manifest/catalog files.

The audit modified nothing: it only read the survey outputs, the re-fetched public
artifacts, and public repository sources, and produced this report and `fp_audit.json`.
