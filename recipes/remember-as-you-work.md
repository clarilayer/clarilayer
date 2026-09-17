# Recipe: Carry a work decision into the next session

**Goal:** save a confirmed decision with its source and applicability, then check that a later AI session can retrieve and use it.

First [connect your AI and update its project instructions](../QUICKSTART.md). The examples below describe fictional work; substitute a real confirmed decision of your own.

## Save the decision

> For the Launch project, we agreed in today's planning session to show the product demo first and put technical details in docs. Remember that confirmed decision with its source and applicability.

The AI should recall relevant existing context before saving a duplicate or correction, then use `remember` with `work_context` and the tool's current schema. It should preserve the source, adoption evidence and project boundary, and report the actual save result.

Useful general work context includes confirmed facts, preferences, decisions, reusable rules and lessons. A suggestion that nobody adopted remains a candidate, not a confirmed decision. Saving a memory does not independently reconcile it.

## Use it later

In a new session connected to the same authorized space:

> Recall the Launch project's saved decisions before drafting the launch page. Explain which decision applies and where it came from.

Check the `recall_context` call and the source/applicability in its output. Project and purpose hints help relevance; they do not grant access or filter away every other project. A project-specific rule remains project-specific. Fetch complete content with `get_context_entry` when the recall preview is insufficient.

A successful MCP connection, delivered instructions or a completion receipt alone does not prove correct use of that decision.

## Correct or forget it

> We changed the Launch decision today: show the customer problem before the demo. Correct the saved decision and retain its source and applicability.

The AI should inspect the existing entry and follow the current correction contract. An ambiguous change should stay in review.

> Forget the saved Launch presentation-order decision. Keep the other Launch memories.

For forget, recall the target first and use the returned entry ID. Do not guess a name or delete other entries that happen to share its source event. Report not-found or failed operations honestly.

## Optional capture

Initial history import requires selected sources, a destination, a qualified extraction provider, an exact preview and acceptance. Ongoing capture needs a separate grant. Neither is enabled by this recipe or by connecting MCP. See the [history guide](https://clarilayer.com/docs/guides/ai-agent-context).

Ad hoc conversation harvest remains explicit: ask the AI to distill candidates and stage them with `propose_batch` for review. Pending proposals are not live recall context; only distilled candidates are sent on that route.

## Specialist work

For Analytics definitions and saved SQL, use the [Analytics bootstrap](./bootstrap-from-sql.md) and [reconcile](./the-reconcile-moment.md) recipes. For repository decisions, constraints and incident lessons, see [engineering context](./remember-engineering-context.md).

General work and engineering context are not reconciled. The live trust statuses are `asserted` / `caveat`; `verified` is not live.
