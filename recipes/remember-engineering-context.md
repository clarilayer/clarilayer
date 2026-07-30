# Recipe: Save engineering context, not just analytics

**Goal:** make the decisions, constraints, and incident lessons your codebase runs on stick, so your coding agent stops re-litigating them.

## The moment

Capture engineering context the instant it's established — a decision closes off an alternative, a constraint gets stated, an incident teaches a lesson. That's when the fact exists and is cheapest to save.

1. Recall first. Before making an engineering decision, have your agent ask what's already known — it calls `get_analysis_context` and builds on stored context about this codebase instead of re-deriving it.
2. When the fact is established, tell the agent to remember it:

   > Remember this as an engineering decision: the sync service polls the provider API — webhooks were the alternative it beat.

3. Your agent calls `remember` with `type: "definition"` and the strict `engineering` object:

   ```json
   {
     "type": "definition",
     "name": "sync-polling-over-webhooks",
     "engineering": {
       "schema_version": 1,
       "kind": "decision",
       "summary": "The sync service polls the provider API; we don't accept webhooks.",
       "rationale": "Webhooks were the alternative it beat — our ingress can't guarantee ordered delivery.",
       "scope_paths": ["services/sync/"],
       "source": { "repo_path": "services/sync/poller.ts", "revision": "a1b2c3d" }
     }
   }
   ```

   `scope_paths` bound where the fact applies; `source` is a caller-asserted repository pointer (`repo_path` + `revision`, optional `anchor`). The `engineering` object can't be combined with `sql`, `metric`, `crm`, or `reasoning`.

## The three kinds

- **`decision`** — a choice that closed off a named alternative (the example above; put the alternative it beat in `rationale`).
- **`constraint`** — an invariant that must hold no matter who chose it, routine conventions included:
  > Remember this as an engineering constraint: monetary amounts are stored as integer cents — never floats.
- **`incident_lesson`** — retrospective only; it exists because something already failed or nearly did:
  > Remember this as an incident lesson: the March backfill double-counted events because the dedupe key omitted `source_id` — never dedupe without it.

If a fact reads as both a decision and a constraint, use `constraint` unless you can name the rejected alternative.

## Notes

- `bootstrap` has no engineering path — it ingests analysis artifacts only (SQL, dbt models, dictionaries, notes). Engineering context enters through `remember`, one entry each.
- `propose` / `propose_batch` don't carry the `engineering` object; engineering facts go through `remember` directly.
- Engineering entries are `asserted` (or `caveat`), never `verified` — ClariLayer doesn't claim to have checked your repo.
