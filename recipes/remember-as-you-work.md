# Recipe: Make your agent remember, so you stop re-explaining

**Goal:** turn one-off corrections into durable context that compounds.

## The loop

Every time you correct your agent about your data, that correction should *stick*. With the [standing-orders stanza](../examples/CLAUDE.md) in your `CLAUDE.md`, your agent does this automatically — but you can also drive it explicitly.

1. You correct something:

   > No — `orders.status = 'fulfilled'` doesn't mean paid. Paid is `payments.status = 'succeeded'`. Don't join on `orders.status` for revenue.

2. Tell the agent to remember it:

   > Remember that for revenue we count `payments.status = 'succeeded'`, never `orders.status`. Save the gotcha.

3. Your agent calls `remember` (default status `asserted`, provenance `you`). Next session, recall (`get_analysis_context`) surfaces it before the agent writes revenue SQL.

## What's worth remembering

- **Definitions** — "active users = distinct users with a session in the last 28 days"
- **Schema notes** — "`events.ts` is UTC; `users.created_at` is local"
- **Reusable SQL** — attach the `SELECT` so it can be reused and later reconciled
- **Assumptions & caveats** — "the `legacy_` tables stopped updating in 2024"
- **Decisions** — "we deprecated the old churn definition; use `churn_v2`"
- **Engineering decisions** — "the sync service polls the provider API" (record the alternative it beat as the rationale)
- **Constraints** — invariants that must hold no matter who chose them, routine conventions included
- **Incident lessons** — retrospective only: it exists because something already failed or nearly did

The engineering kinds ride on `remember` as a `definition` carrying the strict `engineering` object — a `kind` (`decision` | `constraint` | `incident_lesson`), `scope_paths`, and a repository `source` pointer; it can't be combined with `sql`, `metric`, `crm`, or `reasoning`:

```json
{
  "type": "definition",
  "name": "api-handlers-idempotent",
  "engineering": {
    "schema_version": 1,
    "kind": "constraint",
    "summary": "Every public API handler must be idempotent — upstream retries are unconditional.",
    "scope_paths": ["src/api/"],
    "source": { "repo_path": "src/api/middleware/retry.ts", "revision": "9f2c41a" }
  }
}
```

One rule to keep straight: `bootstrap` ingests analysis artifacts only (SQL, dbt models, dictionaries, notes) — engineering context enters through `remember`, one entry each. Full walkthrough: [remember-engineering-context](./remember-engineering-context.md).

## Propose vs. remember

If the agent is *suggesting* rather than recording something you confirmed, it should use `propose` — proposals land in your Context Inbox for review instead of writing straight to your context. For several suggestions at once it uses `propose_batch` (up to ~25 candidates per call). Engineering context is the exception: `propose` / `propose_batch` don't carry the `engineering` object, so engineering facts go through `remember` directly.

That bulk path is what powers **conversation harvest**: ask your agent to harvest the durable facts from a working session and it distills them into candidates and stages them via `propose_batch` for your review. It only runs when you ask, you approve each candidate, and your transcript is never sent to ClariLayer — just the distilled facts. Harvested candidates carry provenance `agent`.

The longer you run this loop, the more grounded your agent gets on *your* data. That compounding context is the point.
