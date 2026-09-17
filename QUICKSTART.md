# Quickstart

Connect your AI, save one confirmed decision or rule, and recall it in a later session.

## 1. Connect your client

Open **[Connect your AI](https://clarilayer.com/connect-ai)**, sign in, and select your client and space. Give its setup request to your AI in the intended project. Complete OAuth when supported, or enter a context key directly in your local client configuration. Do not put keys in chat.

Claude Code, Cursor, Codex and claude.ai are supported connection paths. Other clients need remote Streamable HTTP MCP support; follow their own authentication requirements. History-reader and extraction-provider support are separate from MCP connectivity.

Already connected? Use **Update my AI setup** on that page. Refresh the client's MCP connection if it still exposes the older tool list. A successful health check alone does not prove that new tools are visible to your client.

<details>
<summary>Manual context-key connection</summary>

The hosted MCP endpoint is `https://clarilayer.com/api/mcp/mcp`. Mint a key in Connect your AI and replace `cl_YOUR_CONTEXT_KEY` locally.

**Claude Code:**

```bash
claude mcp add --transport http clarilayer https://clarilayer.com/api/mcp/mcp --header "Authorization: Bearer cl_YOUR_CONTEXT_KEY"
```

The command includes `--transport http` because the endpoint uses remote HTTP. Check registration with `claude mcp list`.

**Cursor**, in `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "clarilayer": {
      "url": "https://clarilayer.com/api/mcp/mcp",
      "headers": { "Authorization": "Bearer cl_YOUR_CONTEXT_KEY" }
    }
  }
}
```

After saving, restart Cursor or refresh its MCP server connection in Settings.

**Codex**, in `~/.codex/config.toml`:

```toml
[mcp_servers.clarilayer]
url = "https://clarilayer.com/api/mcp/mcp"
http_headers = { "Authorization" = "Bearer cl_YOUR_CONTEXT_KEY" }
```

On Codex clients supporting direct HTTP, this configuration needs no Node bridge. Refresh the MCP connection after saving. On clients that support it, `bearer_token_env_var = "CLARILAYER_KEY"` can replace the literal `http_headers` key; make the variable available to the client process.

For older Codex clients without direct HTTP, replace the direct configuration with this Node-based bridge (requires Node.js / `npx`):

```toml
[mcp_servers.clarilayer]
command = "npx"
args = ["-y", "mcp-remote", "https://clarilayer.com/api/mcp/mcp", "--header", "Authorization: Bearer cl_YOUR_CONTEXT_KEY"]
```

If `npx` is unavailable, use a client version supporting direct HTTP, or install Node.js for the bridge.

**claude.ai:** add the endpoint as a custom connector and sign in through OAuth. This path does not need a `cl_…` key.

</details>

## 2. Update the instructions for this project

Use the request from **Update my AI setup** in the selected AI. It fetches `get_project_stanza` with `mode: "full"` and follows the server's current install contract:

| Client | Only this target |
|---|---|
| Claude Code | `CLAUDE.md` |
| Codex | `AGENTS.md` |
| Cursor | `.cursor/rules/clarilayer.mdc` |

An exact recognized old block can be upgraded while preserving surrounding text. Edited, ambiguous or newer blocks need an exact diff and your direction. Finding an old ClariLayer heading does not mean the instructions are current.

The managed bootstrap obtains `get_project_stanza` with `mode: "runtime"` once at the first relevant use in each new AI session. That workflow covers general recall, confirmed saves/corrections and a completion checkpoint. It does not override your instructions or grant access to history.

For a secret-free manual handoff, see [the instruction-request example](./examples/instruction-request.md). The [CLI reference](./CLI.md) distinguishes the source version from the published npm version.

## 3. Save one real rule

Give your AI a confirmed rule from your work, including its source and where it applies. For example:

> For the Launch project, we agreed in today's planning session to show the product demo first and put technical details in docs. Save this confirmed decision in ClariLayer with that source and applicability.

Your AI uses `remember` with `work_context`. It should report whether the save succeeded. Suggestions that you have not adopted belong in review, not in confirmed memory.

## 4. Recall it in a later session

In the same authorized space:

> Recall the Launch project's saved decisions before drafting the launch page. Show the source and applicability of the decision you use.

Check that your AI called `recall_context` and used the returned context appropriately. A tool being available or an instruction being delivered does not prove it was used. An empty result means that query found nothing; it does not prove the entire store is empty.

Correct a decision when it changes. To forget a specific entry, ask the AI to recall it first and use the returned entry ID. Related memories should remain unless you separately ask to remove them.

## 5. Optional history and capture

From Connect your AI, select a supported local history source, destination space and extraction provider. Review the exact preview before accepting the initial import. Separately choose whether to enable ongoing capture for eligible later work.

The current qualified extraction path uses a version-specific Claude CLI profile. OpenAI and Cursor extraction providers are unavailable; native Cursor history qualification is limited. Supported source formats can change, so follow the [current history guide](https://clarilayer.com/docs/guides/ai-agent-context).

Selected source content goes to your chosen extraction provider; ClariLayer stores extracted context rather than a raw transcript archive. Processing may consume provider allowance or incur usage. Optional semantic search has separate organization consent and provider disclosure in Settings.

## Analytics and engineering

General recall works alongside the specialist paths:

- [Remember work context](./recipes/remember-as-you-work.md).
- [Remember an engineering decision, constraint or incident lesson](./recipes/remember-engineering-context.md).
- [Bootstrap supplied Analytics files](./recipes/bootstrap-from-sql.md).
- [Reconcile an Analytics definition](./recipes/the-reconcile-moment.md).
- [Check dbt docs locally](./CLI.md#npx-clarilayer-dbt-check).

General work and engineering context are not reconciled. Analytics/CRM reconcile uses only supported agent-supplied evidence. Live trust statuses are `asserted` / `caveat`; `verified` is not live.

## Troubleshooting

| Symptom | Next step |
|---|---|
| No `recall_context` in the AI's tool list | Refresh the MCP connection and inspect `capabilities`. |
| AI keeps using the old Analytics-only workflow | Run **Update my AI setup** in the intended project. |
| CLI says the standing-orders block is already present | That is the older CLI. Presence is not a version check; use the guided update. |
| Instruction update reports a conflict | Review the exact one-file diff; do not overwrite the whole project instruction file. |
| AI does not recall before work | Check its local instruction result and actual tool calls. MCP cannot force the client to recall. |
| History or capture is unavailable | Check source/provider qualification and the separate setup/grant; connectivity alone is insufficient. |
| Authentication fails | Reauthorize the selected client or replace its local key through Connect your AI. |

For help, open a [setup issue](https://github.com/clarilayer/clarilayer/issues/new?template=connection-help.md). Remove keys and private work context from any report.
