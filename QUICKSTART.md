# Quickstart

Connect ClariLayer to your AI coding agent in about two minutes.

> These commands are kept in sync with the shipped product. If anything here ever disagrees with the in-app **Connect your AI** screen or [clarilayer.com/docs](https://clarilayer.com/docs), trust the app — it renders your real key.

## 1. Get your free context key

1. Sign up at **[clarilayer.com/auth/sign-up](https://clarilayer.com/auth/sign-up)**.
2. Open **Connect your AI**.
3. Mint a context key. It looks like `cl_…` and is shown **once** — copy it now.

Wherever you see `cl_YOUR_CONTEXT_KEY` below, paste your real key.

## 2. Connect your agent

### Claude Code

Run in your terminal:

```bash
claude mcp add --transport http clarilayer https://clarilayer.com/api/mcp/mcp --header "Authorization: Bearer cl_YOUR_CONTEXT_KEY"
```

`--transport http` is required — the CLI defaults to `stdio`. Verify with `claude mcp list`; you should see `clarilayer`.

### Cursor

Add to `~/.cursor/mcp.json` (create it if it doesn't exist):

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

Restart Cursor (or toggle the server in **Settings → MCP**).

### Codex

Recent Codex connects to the hosted endpoint **directly over HTTP — no Node/`npx` required** (just like Claude Code and Cursor). Add to `~/.codex/config.toml`:

```toml
[mcp_servers.clarilayer]
url = "https://clarilayer.com/api/mcp/mcp"
http_headers = { "Authorization" = "Bearer cl_YOUR_CONTEXT_KEY" }
```

To keep your key out of the file, use `bearer_token_env_var = "CLARILAYER_KEY"` in place of `http_headers`. On some Codex versions you may also need `experimental_use_rmcp_client = true` under a `[features]` table.

**Older Codex / fallback.** If your Codex predates direct-HTTP support, bridge it through [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) instead. This route **requires Node.js** (it runs via `npx`):

```toml
[mcp_servers.clarilayer]
command = "npx"
args = ["-y", "mcp-remote", "https://clarilayer.com/api/mcp/mcp", "--header", "Authorization: Bearer cl_YOUR_CONTEXT_KEY"]
```

> **Setting up via an AI agent?** If it reports `npx: command not found` (Node isn't installed), tell it to use the **direct-HTTP** config above — it needs no local dependencies.

## 3. Tell your agent to use it proactively

The MCP connection gives your agent the tools, but agents under-use tools they aren't told to reach for. Paste the standing-orders block from [`examples/CLAUDE.md`](./examples/CLAUDE.md) into your project's `CLAUDE.md` / `AGENTS.md`. Now your agent recalls first and writes back as it learns.

## 4. Bootstrap from what you already have

Don't start from an empty store. In your agent, say something like:

> Bootstrap my ClariLayer context from the SQL in `./analytics/sql` and my dbt models in `./models`.

Your agent calls `bootstrap`. Validated SQL is deterministically structured (tables, joins, group-bys, time grain); dbt models and `CLAUDE.md` are imported as schema-notes / notes.

## 5. The reconcile moment

Pick a metric you've defined and ask:

> Reconcile my "active users" definition against the warehouse.

Your agent runs the stored SQL with its own access, returns the result shape, and ClariLayer compares declared-vs-actual. If they disagree, you get a **caveat** — the "why don't these two numbers match?" moment, caught before it reaches a dashboard.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `claude mcp list` doesn't show `clarilayer` | Re-run the add command; ensure `--transport http` is present. |
| `401 Unauthorized` | The key is wrong, truncated, or revoked. Mint a fresh one in **Connect your AI** and update the header. |
| Cursor / Codex doesn't pick it up | Fully restart the app after editing the config file. |
| `npx: command not found` (Codex) | Node isn't installed. Use the **direct-HTTP** Codex config (`url` + `http_headers`) — it needs no Node. Or install [Node.js](https://nodejs.org). |
| Agent never calls the tools | Add the [standing-orders stanza](./examples/CLAUDE.md) to your `CLAUDE.md`. |

Still stuck? Open a [connection-help issue](https://github.com/clarilayer/clarilayer/issues/new?template=connection-help.md) or email **support@clarilayer.com**.
