# Capabilities

ClariLayer's MCP contract is versioned. Your client discovers the **live, canonical** list of tools and the current capability version at connect — from the `initialize` response, or by calling the `capabilities` tool — so you never have to trust this document over the wire.

**Live snapshot checked September 17, 2026:** capability **v64** · server **0.39.0** · **23 MCP tools**. A capability is an advertised contract; availability still depends on authentication, space permissions and the feature's own controls or consent.

The 23 tools: `archive`, `archive_reasoning`, `bootstrap`, `capabilities`, `capture_context`, `clarilayer__health`, `context_checkpoint`, `forget`, `forget_reasoning`, `get_analysis_context`, `get_context_entry`, `get_project_stanza`, `propose`, `propose_batch`, `recall_context`, `reconcile`, `remember`, `report_context_use`, `restore`, `restore_reasoning`, `suggest_links`, `supersede`, `sync_instruction_setup`.

## General work context

The general-work loop is `recall_context` before relevant work, `remember` with `work_context` for confirmed changes, then `context_checkpoint` for the bounded completion declaration. Source and applicability stay attached. `get_context_entry` can fetch a complete entry by its returned `entry_id`; `forget` accepts that ID as an exclusive alternative to type/name.

`capture_context` serves separately configured, grant-bound collectors. It does not authorize a local scan or make history import automatic. `report_context_use` is optional bounded feedback, and `sync_instruction_setup` records scoped setup evidence. A local instruction outcome is agent-attested; delivery, actual use and answer quality remain separate claims.

`get_project_stanza` supports `runtime` and `full` modes. Current managed protocol **v4** fetches current runtime guidance once at the first relevant use in each AI session. Runtime workflow **v2** asks for recall before each relevant non-trivial task. The server cannot force a host to call a tool.

Analytics retains `get_analysis_context`, supplied-file `bootstrap` and supported warehouse/HubSpot `reconcile`. General work and engineering context are not reconciled.

For repository work, `remember` also accepts the strict `engineering` object: one decision, constraint or incident lesson with scope paths and a repo/revision source pointer. `get_analysis_context` can serve a ranked Engineering context packet. Analytics `bootstrap` does not import a repository's engineering context automatically.

## Recent capability bumps

| Version | What it added |
|---|---|
| **v24** | `propose_batch` — stage several candidate entries in one call (bulk form of `propose`), all landing in the Context Inbox for review. |
| **v25** | `dictionary` as a fourth `bootstrap` source kind (a codebook / data dictionary, structured by the agent into one schema-note per variable); the conversation-harvest protocol — on explicit request, distill a working session's durable facts into candidates and stage them via `propose_batch` (the transcript is never sent; candidates carry provenance `agent`). |
| **v26** | `archive_reasoning` / `restore_reasoning` — reversibly hide (and bring back) a caveat/assumption attached to an entry; a length cap on the `use_case` argument; and the `reconcile` output field renamed to `last_checked` for honesty (a reconcile still emits only `asserted` / `caveat`, never `verified`). |
| **v27** | Attachment-output polish — actionable hints lifted into the structured channel your agent reads: a `reactivation_hint` when a `remember` lands on an archived caveat/assumption, and a no-op hint on the entry lifecycle verbs. Output-only; no new tool. |
| **v28** | A fifth `bootstrap` source kind, `semantic_model` — import a governed **semantic-layer model** (a Databricks Metric View, dbt semantic model, …) as canonical metric definitions. Adds a `semantic_model` provenance to `remember` / `propose` / `propose_batch`. |
| **v29** | `get_analysis_context` can surface an imported-canon **sibling** of a recalled local entry in its `conflicts` annotation — so your agent sees when your local definition differs from the governed one. Output-only; ships behind a default-off switch. |
| **v30** | Every advertised tool now carries MCP behavioral **annotations** (read-only / destructive / idempotent / open-world hints) — a prerequisite for connector-directory listing. Metadata-only. |
| **v31** | New read-only tool **`suggest_links`** — scores your unkeyed local metric definitions against imported canon and suggests which describe the **same concept** (matched on what a metric computes, not its name). You confirm; nothing is auto-applied. Tool set 17 → 18. |
| **v32** | `bootstrap`'s `semantic_model` source gains three explicit **table-role** fields (`model_object_table` / `governed_object_table` / `underlying_source_table`) so a governed view aligns with local definitions that query its base table; and `suggest_links` / the import advisory now return a **`matched_signature`** + **`near_misses`** so a no-match is **diagnosable**, not a silent empty list. |
| **v33** | Recall breaks verification-weight **ties by source tier** — a higher-trust origin orders first among equals. Ordering-only; never overrides verification weight. |
| **v34** | **Primary-context conflict guard** — a healthy in-scope recall no longer promotes a checked metric from a *different* `use_case` as `primary_context`; a `routing_hint` names the off-domain tag instead. |
| **v35** | `get_analysis_context` gains optional **`strict_use_case`** (stay strictly in scope, no cross-scope fallback), plus plain-language copy whenever a cross-domain promote does fire. |
| **v36** | Three additive recall output fields: **`use_case_warning`** (unknown tag), **`off_scope_entries`**, and **`routing_confidence`** on the routed primary. Output-only. |
| **v37** | **Scope-aware ranking** — weak unscoped global rows are demoted below in-scope rows on a scoped recall. Ordering-only. |
| **v38** | **Empty-recall seed hint** — a zero-result recall on a provably empty store returns a static `empty_recall_hint` nudging bootstrap / remember. Output-only. |
| **v39** | **Read-time Diff-to-Team** — recall `conflicts` can surface a diverging team-canon sibling (`team_canon: true`) from the org's shared canon layer, grant-checked. Output-only. |
| **v40** | **Read-time freshness signal** — the team-canon conflict member gains `freshness_stale: true` when both sides' stored reconcile-time SQL fingerprints have diverged. Output-only. |
| **v41** | New strict write-scoped **`context_checkpoint`** tool — durable completion receipts (`context_updated` / `no_update_required`) plus the `before_task_completion` trigger and `get_project_stanza`'s versioned managed block. Tool set 18 → 19. |
| **v42** | **Row-free CRM contracts** — `remember` accepts a strict CRM definition contract, recall advertises `has_crm_contract` + full-fetch guidance, and `reconcile` accepts bounded row-free HubSpot CRM evidence (Salesforce reconcile is disabled). |
| **v43** | **CRM reconcile GA closeout** — recall comparator fix, CRM-aware near-duplicate advisories, an explicit all-org `*` CRM access mode, and `evidence_basis` on enum-usage details. |
| **v44** | **Engineering pack lands on the contract** — `remember` gains an optional strict `engineering` object (one decision, constraint, or incident lesson with scope paths and a repo/revision source pointer); recall additively emits a byte-bounded, revision-traceable **`context_packet`** for Analytics or Engineering routes. |
| **v45** | **Multi-object Engineering packet** — the Engineering `context_packet` widens to a top-3 window: one primary plus up to two supporting objects. Output-only. |
| **v46** | Strict-mode **weak-global served-tail cap**, disclosed honestly via `weak_global_tail_suppressed_count`. Output-only. |
| **v47** | **Kind-aware Engineering packet lead** — an incident lesson atop a non-incident query yields the primary slot to a decision/constraint within the emitted window; incident-shaped queries keep the incident lead. Output-only. |
| **v48** | `remember.engineering.kind` gains **discriminating classification guidance** for `decision` / `constraint` / `incident_lesson` (description-only; flips `remember`'s input schema hash). |
| **v49** | **Engineering-packet exclusions disclosed unconditionally** — identifier-only `policy_excluded` rows for every withheld eligible entry, no longer gated on the multi-object flag. |
| **v50** | **Seed hint composed from the Domain Pack registry** — the empty-recall hint goes domain-neutral: the `remember` prompt enumerates Analytics, Engineering, and CRM vocabularies; bootstrap speaks only for capture-backed packs. |
| **v51** | **Engineering-pack visibility in first-read guidance** — recall's description covers engineering tasks, the recommended stanza / managed block (protocol v2) names engineering decisions, constraints, and incident lessons, and the Connect screen gains an engineering seed prompt. Copy-only. |
| **v52** | Asserted entries outrank caveat entries on the affected ranking ties. No new tool or input schema. |
| **v53** | Additive disclosures for recall losses and truncated content, corrected `use_case` guidance, and explicit engineering non-reconcile guidance. |
| **v54** | Separately controlled body-aware relevance and a metadata-only scoped context index. Contract availability does not itself activate either feature. |
| **v55** | Scoped-index completeness fixes; `entries_by_type` replaces the earlier `entries` shape. Callers recover type from each bucket key. |
| **v56** | `match_strength` adds `unmeasured` so absent measurements do not imply a strong match. |
| **v57** | Structured `work_context` in saves/proposals and selectors in compatible read/lifecycle tools. Work entries preserve privacy and applicability; the contract alone does not enable writes. |
| **v58** | Adds `recall_context` across the selected authorized space and entry-ID full fetch. Project/purpose hints affect relevance, not access or candidate exclusion. 20 tools. |
| **v59** | Adds grant-bound `capture_context` for configured collectors, with exact-preview acceptance for initial history. 21 tools. |
| **v60** | General-work recall/save/correction triggers and general completion facets. Checkpoints remain bounded declarations. |
| **v61** | Capture collector status reporting, distinct from proof of liveness or successful processing. |
| **v62** | Adds optional `report_context_use`, separating delivered context from reported use and attribution gaps. 22 tools. |
| **v63** | General-first runtime guidance, managed v4 bootstrap, runtime/full stanza modes and `sync_instruction_setup`. 23 tools. |
| **v64** | `forget` accepts an exclusive `entry_id` target. Work forget records source exclusions and preserves other existing same-source entries. Runtime v2 explicitly requests recall before each relevant task; managed v4 and the 23-tool set remain unchanged. |

## A note on trust language

Across every version, reconcile produces **`asserted`** or **`caveat`** only — it does **not** stamp `verified`, and nothing ever becomes `verified`. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the ground rule.
