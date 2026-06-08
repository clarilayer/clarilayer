# Recipe: "Why don't these two numbers match?"

**Goal:** catch a definition that's drifted from reality *before* it lands in a report.

This is the moment ClariLayer is built for — a stored definition says one thing, the warehouse says another.

## Steps

1. Save (or bootstrap) a definition that includes its SQL — e.g. the `net_revenue` query in [`../examples/analytics/sql/revenue.sql`](../examples/analytics/sql/revenue.sql).
2. Ask your agent to reconcile it:

   > Reconcile my "net revenue" definition against the warehouse.

3. Your agent runs the stored SQL **with its own warehouse access**, returns the result shape (columns, optional preview rows, optional row count), and ClariLayer compares declared-vs-actual.
4. Read the outcome:
   - **caveat** — declared and actual disagree. ClariLayer flags it. This is the win: you found the mismatch on your terms, not in a board meeting.
   - **asserted** — nothing contradicted it (or there was nothing checkable). It stays asserted.

## Honesty note

v1 reconcile produces **`caveat`** or **`asserted`** only. It does **not** stamp `verified` — that's the documented fast-follow. Don't describe a clean reconcile as "verified."

## Why this beats a hand-written doc

A `CLAUDE.md` definition is asserted text with the same trust problem as the original number. `reconcile` is the difference between *claiming* a definition is right and *checking* it against your data.
