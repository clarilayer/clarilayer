<!--
Copy the block below into your own project's CLAUDE.md or AGENTS.md.
It makes your AI agent use ClariLayer proactively (recall-first, write-back)
instead of waiting to be asked. This is a convenience copy of the product's
RECOMMENDED_AGENT_STANZA — the canonical source of truth; the server's
`get_project_stanza` verb always returns the current text, so prefer that
if this copy looks stale. Last synced: 2026-07-30.
-->

## ClariLayer — your data context layer (use it proactively)

ClariLayer is connected over MCP and holds this project's durable data and engineering context: definitions, schema notes, reusable SQL, assumptions, caveats, decisions, and the engineering decisions, constraints, and incident lessons this repository relies on. Use it WITHOUT waiting to be asked.

- Bootstrap once, from files: to ground a fresh store, call `bootstrap` with the content of files the user already has — SQL, dbt models, `CLAUDE.md` / notes, or a codebook / data dictionary (mapped into the `dictionary` source's rows). YOU read and supply that file content; ClariLayer never connects to or reads the warehouse — it feeds on files, never the data. `bootstrap` ingests analysis artifacts only — when grounding from a repository, save its engineering context (decisions, constraints, incident lessons) through `remember`, one entry each.
- Recall first: before writing SQL, defining or computing a metric, making an engineering decision, or answering a question about this data or codebase, call `get_analysis_context` (pass a `use_case`). Build on what is already known instead of re-deriving it. Recall returns display-capped previews — when you need an entry's full stored content (its complete body, CRM contract, or saved SQL), fetch it with `get_context_entry` (type + name). A `has_crm_contract:true` marker always requires that full fetch.
- Write back as you learn: when you establish a durable fact — a definition, row-free CRM contract, schema note, reusable query (attach the SELECT as `sql`), assumption, caveat, or decision — save it with `remember`. Save an engineering decision, constraint, or incident lesson as a `definition` carrying the strict `engineering` object (its `kind`, `scope_paths`, and repository `source` pointer; it cannot be combined with `sql`, `metric`, `crm`, or `reasoning`). In a CRM declaration, `expected_values` and `canonical_value.value` assert positive record usage; never repeat the canonical value in `expected_values`; deprecated aliases are conflict candidates, and labels are checked against option metadata. Use `propose` for suggestions (they go to the human's review inbox).
- Harvest only when asked: if (and only if) the user asks you to learn from this conversation, stage the durable facts via ONE `propose_batch` call with `provenance: "agent"` and review them in the Inbox — never ambiently, never auto-accepted; the raw transcript is never sent, only the distilled candidates.
- Reconcile on drift: if a definition's SQL changed, staleness is flagged, or a HubSpot CRM contract needs checking, call `reconcile` with warehouse shape or bounded row-free `crm_evidence` metadata and distributions. Configured-but-unused means absent or exact-zero in a complete record distribution, not absent from provider metadata; incomplete evidence stays asserted-only. Use your own provider access; never send CRM rows or credentials. Salesforce reconcile is disabled.
- Stay honest: treat status as `asserted`/`caveat`, never `verified`.
