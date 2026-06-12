# Capabilities

ClariLayer's MCP contract is versioned. Your client discovers the **live, canonical** list of tools and the current capability version at connect — from the `initialize` response, or by calling the `capabilities` tool — so you never have to trust this document over the wire.

**Current:** capability **v26** · server **0.13.0** · **17 MCP tools**.

The 17 tools: `archive`, `archive_reasoning`, `bootstrap`, `capabilities`, `clarilayer__health`, `forget`, `forget_reasoning`, `get_analysis_context`, `get_context_entry`, `get_project_stanza`, `propose`, `propose_batch`, `reconcile`, `remember`, `restore`, `restore_reasoning`, `supersede`.

## Recent capability bumps

| Version | What it added |
|---|---|
| **v24** | `propose_batch` — stage several candidate entries in one call (bulk form of `propose`), all landing in the Context Inbox for review. |
| **v25** | `dictionary` as a fourth `bootstrap` source kind (a codebook / data dictionary, structured by the agent into one schema-note per variable); the conversation-harvest protocol — on explicit request, distill a working session's durable facts into candidates and stage them via `propose_batch` (the transcript is never sent; candidates carry provenance `agent`). |
| **v26** | `archive_reasoning` / `restore_reasoning` — reversibly hide (and bring back) a caveat/assumption attached to an entry; a length cap on the `use_case` argument; and the `reconcile` output field renamed to `last_checked` for honesty (a reconcile still emits only `asserted` / `caveat`, never `verified`). |

## A note on trust language

Across every version, reconcile produces **`asserted`** or **`caveat`** only — it does **not** stamp `verified`. The stronger `verified` status is a documented fast-follow, not shipped. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the ground rule.
