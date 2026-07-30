# Capabilities

ClariLayer's MCP contract is versioned. Your client discovers the **live, canonical** list of tools and the current capability version at connect — from the `initialize` response, or by calling the `capabilities` tool — so you never have to trust this document over the wire.

**Current:** capability **v51** · server **0.31.0** · **19 MCP tools**.

The 19 tools: `archive`, `archive_reasoning`, `bootstrap`, `capabilities`, `clarilayer__health`, `context_checkpoint`, `forget`, `forget_reasoning`, `get_analysis_context`, `get_context_entry`, `get_project_stanza`, `propose`, `propose_batch`, `reconcile`, `remember`, `restore`, `restore_reasoning`, `suggest_links`, `supersede`.

The contract covers **engineering context alongside analytics context**: `remember` accepts a strict `engineering` object (one decision, constraint, or incident lesson, with scope paths and a repo/revision source pointer), and `get_analysis_context` can serve a ranked **Engineering context packet** for a code-repo task. (`bootstrap` ingests analytics artifacts only — repo-grounded engineering facts route through `remember`.)

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

## A note on trust language

Across every version, reconcile produces **`asserted`** or **`caveat`** only — it does **not** stamp `verified`, and nothing ever becomes `verified`. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the ground rule.
