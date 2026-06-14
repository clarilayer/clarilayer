# Capabilities

ClariLayer's MCP contract is versioned. Your client discovers the **live, canonical** list of tools and the current capability version at connect — from the `initialize` response, or by calling the `capabilities` tool — so you never have to trust this document over the wire.

**Current:** capability **v32** · server **0.19.0** · **18 MCP tools**.

The 18 tools: `archive`, `archive_reasoning`, `bootstrap`, `capabilities`, `clarilayer__health`, `forget`, `forget_reasoning`, `get_analysis_context`, `get_context_entry`, `get_project_stanza`, `propose`, `propose_batch`, `reconcile`, `remember`, `restore`, `restore_reasoning`, `suggest_links`, `supersede`.

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

## A note on trust language

Across every version, reconcile produces **`asserted`** or **`caveat`** only — it does **not** stamp `verified`. The stronger `verified` status is a documented fast-follow, not shipped. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the ground rule.
