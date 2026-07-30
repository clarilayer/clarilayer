# The `clarilayer` CLI

One command to connect ClariLayer to your AI coding agent.

```bash
npx clarilayer init
```

It will:

1. Ask for your free context key (or read `--key` / `CLARILAYER_CONTEXT_KEY`).
2. Check the key against `clarilayer.com` (a hard rejection stops; network hiccups don't).
3. Let you pick which agents to connect — it auto-detects Claude Code, Cursor, and Codex.
4. Write each agent's MCP config **without clobbering** your existing servers (and back up any file it edits).
5. Offer to add the proactive standing-orders block to your `./CLAUDE.md`.

Don't have a key yet? Sign up at **[clarilayer.com](https://clarilayer.com/auth/sign-up)** → **Connect your AI**.

## Options

| Flag | Meaning |
|---|---|
| `--key <cl_…>` | Use this key (or set `CLARILAYER_CONTEXT_KEY`) |
| `--agent <id>` | Configure just one: `claude-code` \| `cursor` \| `codex` |
| `--open` | Offer to open the browser to mint a key |
| `--no-stanza` | Skip the `CLAUDE.md` standing-orders block |
| `--skip-verify` | Don't call `clarilayer.com` to check the key |
| `--dry-run` | Show what would happen; write nothing |
| `-y, --yes` | Non-interactive (accept defaults, auto-detect agents) |

Non-interactive example (CI / scripts):

```bash
CLARILAYER_CONTEXT_KEY=cl_xxx npx clarilayer init --yes --agent cursor
```

## What it writes

| Agent | Location | How |
|---|---|---|
| Claude Code | via `claude mcp add` | runs the official command for you |
| Cursor | `~/.cursor/mcp.json` | merges a `clarilayer` server entry |
| Codex | `~/.codex/config.toml` | appends an `[mcp_servers.clarilayer]` block |

Your context key is written into your **local** agent config only — it is never sent anywhere except, by your agent, to the ClariLayer MCP endpoint as a bearer token.

## Development

```bash
npm install
npm run build       # tsc → dist/
node dist/index.js --help
node dist/index.js init --dry-run --key cl_demo_1234567890 --skip-verify
```

The connection constants (endpoint, server name, stanza) live in `src/lib/constants.ts` as a **pinned copy** of the product's source of truth, last synced at capability v51 (2026-07-30). The canonical, always-current stanza text is served by the `get_project_stanza` verb — when the product stanza moves, re-sync the pinned copy from it.
