# Recipe: Make your agent remember, so you stop re-explaining

**Goal:** turn one-off corrections into durable context that compounds.

## The loop

Every time you correct your agent about your data, that correction should *stick*. With the [standing-orders stanza](../examples/CLAUDE.md) in your `CLAUDE.md`, your agent does this automatically — but you can also drive it explicitly.

1. You correct something:

   > No — `orders.status = 'fulfilled'` doesn't mean paid. Paid is `payments.status = 'succeeded'`. Don't join on `orders.status` for revenue.

2. Tell the agent to remember it:

   > Remember that for revenue we count `payments.status = 'succeeded'`, never `orders.status`. Save the gotcha.

3. Your agent calls `remember` (default status `asserted`, provenance `you`). Next session, `recall` surfaces it before the agent writes revenue SQL.

## What's worth remembering

- **Definitions** — "active users = distinct users with a session in the last 28 days"
- **Schema notes** — "`events.ts` is UTC; `users.created_at` is local"
- **Reusable SQL** — attach the `SELECT` so it can be reused and later reconciled
- **Assumptions & caveats** — "the `legacy_` tables stopped updating in 2024"
- **Decisions** — "we deprecated the old churn definition; use `churn_v2`"

## Propose vs. remember

If the agent is *suggesting* rather than recording something you confirmed, it should use `propose` — proposals land in your Context Inbox for review instead of writing straight to your context. For several suggestions at once it uses `propose_batch` (up to ~25 candidates per call).

That bulk path is what powers **conversation harvest**: ask your agent to harvest the durable facts from a working session and it distills them into candidates and stages them via `propose_batch` for your review. It only runs when you ask, you approve each candidate, and your transcript is never sent to ClariLayer — just the distilled facts. Harvested candidates carry provenance `agent`.

The longer you run this loop, the more grounded your agent gets on *your* data. That compounding context is the point.
