# The `clarilayer` CLI

<!-- DRAFT — founder copy review pending (D-002) -->

Two subcommands: [`init`](#npx-clarilayer-init) connects ClariLayer to your AI coding agent; [`dbt-check`](#npx-clarilayer-dbt-check) checks a dbt project's YAML docs against the warehouse catalog.

## `npx clarilayer init`

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

### Options

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

### What it writes

<!-- DRAFT — founder copy review pending (D-002) -->

| Agent | Location | How |
|---|---|---|
| Claude Code | via `claude mcp add` | runs the official command for you |
| Cursor | `~/.cursor/mcp.json` | merges a `clarilayer` server entry |
| Codex | `~/.codex/config.toml` | appends an `[mcp_servers.clarilayer]` block |

Your context key is written into your **local** agent config only, and it only ever travels to the ClariLayer MCP endpoint: `init` sends it there once to validate it (skipped with `--skip-verify`, and a `--dry-run` makes no network calls), and after install your agent sends it as the bearer token on each MCP call.

## `npx clarilayer dbt-check`

<!-- DRAFT — founder copy review pending (D-002) -->

Checks a dbt project's YAML docs against what the warehouse actually reported, and lists the drift findings. It reads two local files that `dbt docs generate` writes — `target/manifest.json` (your declared docs) and `target/catalog.json` (the warehouse's answer) — and compares them. **Local and read-only by default: no account, no key, nothing leaves your machine.**

```bash
cd your-dbt-project
dbt docs generate
npx clarilayer dbt-check
```

What it reports, most severe first:

- **Phantom columns** — documented in YAML, missing from the warehouse catalog; with a rename candidate ("did you mean X?") when a close match exists.
- **Models never built** — documented, but no relation in the warehouse.
- **Type family mismatches** — the declared `data_type` resolves to a different type family than the warehouse's (conservative: unrecognized types are never guessed into a family, so no false alarms from vendor-specific names).
- **Hollow descriptions** — columns declared but with an empty description.
- Then a **not-checked disclosure** (what this run honestly didn't cover) and one **coverage** line, always last.

Findings are *drift findings* — this tool compares two files dbt already wrote; a clean run reports "no drift found", never anything stronger.

### Options

| Flag | Default | Meaning |
|---|---|---|
| `--project-dir <dir>` | current directory | dbt project directory |
| `--target-path <dir>` | `<project-dir>/target` | where `manifest.json` + `catalog.json` live |
| `--top <n>` | `10` | findings listed per section in the terminal report (whole number ≥ 0); the rest collapse into an "…and N more" line |
| `--md <file>` | off | also write the **full** drift report (no display caps) as markdown to `<file>` |
| `--json` | off | print the full report as JSON on stdout; status goes to stderr |
| `--max-artifact-mb <n>` | `300` | per-artifact size cap in MB, checked by file size before parsing |
| `--save` | off | stage top drift objects (plus a run-summary proposal) in your ClariLayer Context Inbox |
| `--save-top <n>` | `10` | drift objects staged with `--save` (1–24) |
| `--key <cl_…>` | `CLARILAYER_CONTEXT_KEY` | context key for `--save` |
| `--dry-run` | off | with `--save`: print the exact request body on stdout; send nothing |
| `-h, --help` | | help — printed to stderr under `--json`, keeping stdout pure |

`--save-top`, `--key`, and `--dry-run` are refused without `--save` (a usage error, exit 2) rather than silently ignored.

**Artifact requirements.** Both files must exist — `catalog.json` is only produced by `dbt docs generate` (`dbt run`/`build` alone doesn't write it). Supported schema versions: manifest **v10/v11/v12** (dbt-core 1.7+), catalog **v1**. A missing, oversized, malformed, or unsupported artifact is refused with an actionable message — never a partial report.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | The check completed — with or without findings. Drift findings never fail the exit code, and a partially-accepted save still counts as completed. |
| `2` | Usage, artifact, or staging problem: bad flag values, missing/oversized/malformed/unsupported artifacts, an unwritable `--md` path, or a failed `--save` call. The actionable message is on stderr. |

There are no other exit codes.

### Stream contract

stdout carries the report and nothing else: the terminal rendering by default, **exactly the JSON document** under `--json` — so `npx clarilayer dbt-check --json | jq .` always works — and, under `--save --dry-run`, the exact would-be request body replaces the report. Every status and error line goes to stderr. One amendment: `--save` status lines join stdout in the terminal rendering, but move to stderr under `--json` so the JSON document stays the only stdout content.

### `--save`: stage findings to your Context Inbox

`--save` turns a drift report into reviewable context. It stages the top finding-bearing objects — a documented column or model, carrying all of its drift findings; the `--save-top` cap (default 10, up to 24) counts these objects, not raw findings — plus one run-summary note, as **proposals** in your ClariLayer Context Inbox: one `propose_batch` call to the hosted MCP endpoint, nothing more. You review each proposal one-by-one; the ones you accept land as `asserted` entries — each drift proposal as a schema note, the run summary as a plain note — never anything stronger, never "verified". Hollow descriptions and coverage stats are never staged.

```bash
npx clarilayer dbt-check --save --key cl_…        # or: export CLARILAYER_CONTEXT_KEY=cl_…
```

You need a free context key: mint one at **[clarilayer.com/connect-ai](https://clarilayer.com/connect-ai)** and pass it with `--key` or `CLARILAYER_CONTEXT_KEY`.

**What crosses the wire — and what never does.** Your artifacts never leave the machine. Only the selected findings' bounded metadata is sent: model/column identity, the drift facts, and a short human-readable summary — capped locally (32 KiB per item, 200 KiB per call) before any network. The request never follows redirects, your key is redacted from every terminal line, and an auth failure prints fixed local guidance only. One call, a 10-second timeout, no retries — on any failure nothing is staged and the local report is unaffected.

**Preview first.** `--save --dry-run` prints the exact request body that *would* be sent on stdout and sends nothing — zero network, and it doesn't need a key, so you can inspect the payload before minting one:

```bash
npx clarilayer dbt-check --save --dry-run
```

Full guide: [clarilayer.com/docs/guides/dbt-check](https://clarilayer.com/docs/guides/dbt-check)

## Development

```bash
npm install
npm run build       # tsc → dist/
npm run typecheck
npm test
node dist/index.js --help
node dist/index.js init --dry-run --key cl_demo_1234567890 --skip-verify
node dist/index.js dbt-check --target-path test/fixtures/phantom-column
```

The connection constants (endpoint, server name, stanza) live in `src/lib/constants.ts` as a **pinned copy** of the product's source of truth, last synced at capability v51 (2026-07-30). The canonical, always-current stanza text is served by the `get_project_stanza` verb — when the product stanza moves, re-sync the pinned copy from it.
