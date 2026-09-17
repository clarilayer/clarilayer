[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/clarilayer-clarilayer-badge.png)](https://mseep.ai/app/clarilayer-clarilayer)

<p align="center">
  <img src="./assets/logomark.svg" alt="ClariLayer" width="84" />
</p>

<h1 align="center">ClariLayer</h1>

<p align="center">
  <b>Your AI should remember how you work.</b><br/>
  Turn selected past conversations into memory your AI can use across projects and sessions.
</p>

<p align="center">
  <a href="https://clarilayer.com">Website</a> ·
  <a href="https://clarilayer.com/docs">Docs</a> ·
  <a href="https://clarilayer.com/connect-ai">Connect your AI</a> ·
  <a href="./QUICKSTART.md">Quickstart</a>
</p>

ClariLayer keeps the facts, preferences, decisions, rules and lessons you choose to carry forward. Connect Claude Code, Cursor, Codex, claude.ai or another compatible remote MCP client. Your AI can recall relevant work context from the selected authorized space, with its source and applicability visible.

Start free. No credit card for the current personal offer.

## One decision, carried into the next session

You settle a launch decision with your AI:

> For the Launch project, show the product demo first. Technical detail belongs in docs. Remember this confirmed decision with its source and project applicability.

In a later session:

> Recall the Launch project's saved decisions before drafting the launch page. Show which decision applies and where it came from.

The decision can travel across projects and sessions within the authorized space while retaining its original applicability. A rule for one customer or project stays bounded. If it changes, correct it; if it no longer belongs, use scoped forget or exclusion.

Recall depends on the AI client actually calling the tool. Connecting MCP does not guarantee every answer uses saved context.

## Connect your AI

Use **[Connect your AI](https://clarilayer.com/connect-ai)** for guided setup. Select your client and space, give the setup request to that AI, and complete authentication in the client. Use OAuth when the selected route supports it, or store a context key locally as the fallback. Never paste a key into an AI conversation or a GitHub issue.

Already connected? Choose **Update my AI setup** on the same page, then run its request in the intended project. This updates one recognized ClariLayer instruction block while preserving your own instructions.

| Client | Project instruction target |
|---|---|
| Claude Code | `CLAUDE.md` |
| Codex | `AGENTS.md` |
| Cursor | `.cursor/rules/clarilayer.mdc` |
| claude.ai / other remote clients | Follow the connection and runtime guidance supported by that client |

The installed bootstrap obtains the current workflow from `get_project_stanza` with `mode: "runtime"` once at the first relevant use in each new AI session. A routine server guidance update then reaches the next session without copying another long workflow into every project.

### Optional setup CLI

The npm CLI supports context-key connection setup and a local dbt check. For the currently published CLI, skip its older embedded instructions and use the guided update above:

```bash
npx clarilayer init --no-stanza
```

**Release status, checked September 17, 2026:** this repository prepares CLI **0.3.0**; npm `latest` is still **0.2.1**. The updated CLI replaces the embedded instructions with a request for your connected AI and adds an `instructions --agent <client>` command. See [CLI.md](./CLI.md) for the source-checkout route and [RELEASING.md](./RELEASING.md) for the separate npm publication step.

Full setup, manual connection examples and troubleshooting: **[QUICKSTART.md](./QUICKSTART.md)**.

## What your AI can do

| Work | How it works |
|---|---|
| Recall | `recall_context` retrieves relevant saved context across the selected authorized space. Preserve source and applicability; project and purpose are relevance hints, not permissions. Fetch complete entries with `get_context_entry` when needed. |
| Remember or correct | `remember` with `work_context` saves confirmed durable facts, preferences, decisions, rules and lessons. Ambiguous changes and suggestions remain candidates for review. |
| Forget | Recall the target first, then use its returned entry ID for the requested forget operation. Do not guess names or delete related entries without a separate request. |
| Complete the context loop | `context_checkpoint` records the AI's bounded completion declaration. It does not prove the AI used the right context or completed an external task. |
| Report use | `report_context_use` optionally links bounded feedback to delivered context. A delivery receipt alone is not evidence of answer quality. |

The hosted MCP service was checked on **September 17, 2026**: **capability v64 · server 0.39.0 · 23 tools**. Use the live `capabilities` tool for the current list and versions. [Capability reference](./CAPABILITIES.md).

## Bring over selected history

After connection, you can choose supported local history, a destination space and an extraction provider, then inspect the exact preview before accepting an initial import. Ongoing capture requires a separate setup and grant for the sources you choose. Connecting MCP alone does not read history or enable capture.

Source support and extraction-provider support are separate. The current qualified extraction path uses a version-specific Claude CLI profile; OpenAI and Cursor extraction providers are unavailable, and native Cursor history qualification is limited. Check the [current history guide](https://clarilayer.com/docs/guides/ai-agent-context) before choosing a source.

Selected source content is processed by the chosen extraction provider. ClariLayer stores the extracted context rather than a raw transcript archive. Provider processing may use your allowance or incur provider usage charges.

Optional semantic search has separate organization consent and provider disclosure in Settings. A new connection or history-import choice does not grant that consent. Lexical recall remains available without it.

## Analytics when your work needs it

ClariLayer for Analytics retains its specialist tools:

- `get_analysis_context` recalls definitions, schema notes, saved queries and related context. Recall previews can be truncated; use `get_context_entry` for full bodies, stored SQL and CRM contracts.
- `bootstrap` imports supplied SQL, dbt models, notes, data dictionaries and semantic models. It does not read a repository or warehouse by itself.
- `reconcile` compares a saved definition with supported warehouse or bounded, row-free HubSpot evidence supplied by your agent. Salesforce contracts can be stored and recalled; Salesforce reconcile is disabled.

General work and engineering context are **not independently reconciled**. Live trust statuses remain **`asserted` / `caveat`**; `verified` is not live.

<details>
<summary>Watch the Analytics reconcile example</summary>

![Analytics example: recall a net-revenue definition, compare it with warehouse evidence, then retain a mismatch as a caveat](./assets/demo-walkthrough.gif)

A seeded Analytics demo. Your agent supplies the warehouse evidence; a mismatch becomes a caveat for later sessions. This illustrates the Analytics specialist path.

</details>

### Check dbt documentation locally

```bash
cd your-dbt-project
dbt docs generate
npx clarilayer dbt-check
```

The CLI compares local `manifest.json` and `catalog.json` files for phantom columns, missing catalog models, type-family mismatches and empty descriptions. No account or warehouse connection is needed for the local check. With an explicit `--save`, bounded findings are staged as proposals in your Context Inbox for review. `--save --dry-run` previews the payload without a network request.

See the [CLI reference](./CLI.md#npx-clarilayer-dbt-check) and [Analytics recipes](./recipes/bootstrap-from-sql.md).

## Control and privacy

- Saved context retains its source and applicability. Separate spaces do not merge automatically.
- History import, ongoing capture and semantic processing each have their own setup or consent boundary.
- In the personal MCP reconcile path, ClariLayer holds no warehouse or CRM credentials, executes no SQL and calls no HubSpot API. Your agent supplies the evidence. Warehouse evidence may include optional preview rows; CRM evidence is row-free.
- Suggestions can be staged with `propose` / `propose_batch` for review. Pending proposals are not live recall context. Ad hoc conversation harvest requires an explicit request and sends distilled candidates, not the transcript.

[Security](https://clarilayer.com/security) · [Privacy](https://clarilayer.com/privacy) · [Pricing](https://clarilayer.com/pricing)

## What is open source?

This repository's docs, examples, recipes and setup/dbt CLI are **MIT licensed**. The **hosted ClariLayer service is proprietary**. This repository is the public starting point for connecting to the service.

The **Governed Context Edge** is available through a hand-run private team pilot. [Request early access](https://clarilayer.com/for-teams).

For contributions and setup help, see [CONTRIBUTING.md](./CONTRIBUTING.md).
