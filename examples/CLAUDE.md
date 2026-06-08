<!--
Copy the block below into your own project's CLAUDE.md or AGENTS.md.
It makes your AI agent use ClariLayer proactively (recall-first, write-back)
instead of waiting to be asked. This is the single canonical stanza — it
matches what the in-app "Connect your AI" screen recommends.
-->

## ClariLayer — your data context layer (use it proactively)

ClariLayer is connected over MCP and holds this project's durable data context: definitions, schema notes, reusable SQL, assumptions, caveats, and decisions. Use it WITHOUT waiting to be asked.

- Recall first: before writing SQL, defining or computing a metric, or answering a question about this data, call `get_analysis_context` (pass a `use_case`). Build on what is already known instead of re-deriving it.
- Write back as you learn: when you establish a durable fact — a definition, schema note, reusable query (attach the SELECT as `sql`), assumption, caveat, or decision — save it with `remember`. Use `propose` for suggestions (they go to the human's review inbox).
- Reconcile on drift: if a definition's SQL changed or staleness is flagged, call `reconcile` to check it against the warehouse.
- Stay honest: treat status as `asserted`/`caveat`, never `verified`.
