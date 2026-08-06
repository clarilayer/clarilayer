[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/clarilayer-clarilayer-badge.png)](https://mseep.ai/app/clarilayer-clarilayer)

<p align="center">
  <img src="./assets/logomark.svg" alt="ClariLayer" width="84" />
</p>

<h1 align="center">ClariLayer</h1>

<p align="center">
  <b>Stop re-explaining your data to your AI every session.</b>
</p>

<p align="center">
  The individual-analyst <b>context layer</b>, delivered over <b>MCP</b>.<br/>
  Connect it to Claude Code, Cursor, Codex, or claude.ai — your agent stops making the same data mistakes.
</p>

<p align="center">
  <a href="https://clarilayer.com">Website</a> ·
  <a href="https://clarilayer.com/docs">Docs</a> ·
  <a href="https://clarilayer.com/auth/sign-up">Get started (free)</a> ·
  <a href="https://clarilayer.com/use-cases">Use cases</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/MCP-server-5b46f5" alt="MCP server" />
  <img src="https://img.shields.io/badge/Claude_Code_·_Cursor_·_Codex_·_claude.ai-supported-1f883d" alt="Clients" />
  <img src="https://img.shields.io/badge/individuals-free-1f883d" alt="Free for individuals" />
</p>

---

> ClariLayer is an individual-analyst context layer, delivered over MCP. Connect it to Claude Code, Cursor, Codex, or claude.ai and it bootstraps your real working context from the SQL and dbt you already have, reconciles your definitions against your warehouse, and remembers your corrections — so your agent stops re-explaining your data and stops making the same mistakes every session.

<p align="center">
  <img src="./assets/demo-walkthrough.gif" alt="ClariLayer in Claude Code: the agent recalls a saved net-revenue definition, reconciles it against the warehouse, finds refunds the definition excludes, and flags the entry with a caveat that's waiting in the next session" width="900" />
</p>
<p align="center">
  <sub><i>A seeded demo warehouse: your agent <b>recalls</b> a saved definition, <b>reconciles</b> it against real results, and the mismatch is flagged as a <code>caveat</code> that's waiting next session. Statuses are <code>asserted</code> / <code>caveat</code> — never "verified".</i></sub>
</p>

## The problem

Every new session, your AI coding agent starts from zero about *your* data. So it makes the same mistakes — queries the wrong table, picks the wrong join, counts refunds in revenue, uses a churn definition you deprecated months ago. You correct it. Next session, it forgets, and you correct it again.

A hand-written `CLAUDE.md` of definitions helps a little — but it has the *same trust problem as the original numbers*: it's just asserted text. Nobody checked it against your warehouse.

## What ClariLayer does

It gives your agent a durable, **reconciled** memory of your data context — and it lives **inside the agent you already use**, over [MCP](https://modelcontextprotocol.io). Four verbs, all live:

| Verb | What it does |
|---|---|
| **recall** | Before writing SQL, defining a metric, making an engineering decision, or answering a question about your data or codebase, your agent pulls the most relevant saved context — each with its provenance and status. Read-only, in-flow. |
| **remember** | Saves one durable fact — a definition, schema note, reusable query, assumption, caveat, or decision — so it survives across sessions. Engineering context — a decision, constraint, or incident lesson — saves the same way, via `remember`'s strict `engineering` object with scope paths and a repo/revision source pointer. |
| **bootstrap** | Bulk-imports context from artifacts you already have, across **five source kinds**: a SQL `SELECT` (deterministically structured), a **data dictionary** / codebook (structured into one schema-note per variable), dbt models, `CLAUDE.md` / freeform notes, and a governed **semantic-layer model** (a Databricks Metric View, dbt semantic model, … imported as canonical metric definitions). No cold empty store. |
| **reconcile** | Grounds a saved definition against your **real** warehouse result — or, for a CRM definition, bounded row-free HubSpot evidence. Your agent runs the SQL (or reads the CRM metadata) with its own access and reports back, so a declared-vs-actual mismatch surfaces as a **caveat**. |

The context you build **compounds** across sessions and is **portable** across Claude Code, Cursor, Codex, and claude.ai.

These four verbs are the in-flow core loop. The full contract today is **19 MCP tools at capability v51** (the four above plus `propose` / `propose_batch`, the entry and reasoning lifecycle, `supersede`, the read-only `suggest_links`, `get_context_entry` for an entry's full stored content, `get_project_stanza`, the completion-receipt `context_checkpoint`, `capabilities`, and a health check). The canonical, live list is always discoverable by your client at connect — via the `initialize` response or a `capabilities` call — so you never have to trust a doc over the wire. See [`CAPABILITIES.md`](./CAPABILITIES.md) for what each recent capability bump added.

## Install

**Fastest — one command.** Auto-detects Claude Code, Cursor, and Codex, writes the right config, and offers to add the standing-orders block to your `CLAUDE.md`:

```bash
npx clarilayer init
```

You'll need a free context key — sign up at **[clarilayer.com](https://clarilayer.com/auth/sign-up)**, then open **Connect your AI** to mint one. The CLI prompts for it and validates it. Full options: **[CLI.md](./CLI.md)**.

<details>
<summary><b>Prefer to wire it up by hand?</b></summary>

<br/>

Replace `cl_YOUR_CONTEXT_KEY` with your key.

**Claude Code** — run in your terminal:

```bash
claude mcp add --transport http clarilayer https://clarilayer.com/api/mcp/mcp --header "Authorization: Bearer cl_YOUR_CONTEXT_KEY"
```

**Cursor** — add to `~/.cursor/mcp.json`:

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

**Codex** — add to `~/.codex/config.toml`. Recent Codex connects to the URL directly, **no Node/`npx` needed** (same as Claude Code and Cursor):

```toml
[mcp_servers.clarilayer]
url = "https://clarilayer.com/api/mcp/mcp"
http_headers = { "Authorization" = "Bearer cl_YOUR_CONTEXT_KEY" }
```

Only on older Codex without direct-HTTP support, bridge it via `mcp-remote` instead — this route **requires Node.js** (`npx`):

```toml
[mcp_servers.clarilayer]
command = "npx"
args = ["-y", "mcp-remote", "https://clarilayer.com/api/mcp/mcp", "--header", "Authorization: Bearer cl_YOUR_CONTEXT_KEY"]
```

</details>

**On claude.ai?** No context key needed — claude.ai connects over OAuth instead. Open **Settings → Connectors → Add custom connector**, paste `https://clarilayer.com/api/mcp/mcp`, then sign in and approve when prompted. There is no `cl_…` key on this path.

See **[QUICKSTART.md](./QUICKSTART.md)** for the full walkthrough and troubleshooting.

## Then tell your agent to actually use it

Paste this into your project's `CLAUDE.md` (or `AGENTS.md`) so your agent reaches for ClariLayer proactively instead of waiting to be asked. The same stanza, as a ready-to-paste file, is [`examples/CLAUDE.md`](./examples/CLAUDE.md):

```markdown
## ClariLayer — your data context layer (use it proactively)

ClariLayer is connected over MCP and holds this project's durable data and engineering context: definitions, schema notes, reusable SQL, assumptions, caveats, decisions, and the engineering decisions, constraints, and incident lessons this repository relies on. Use it WITHOUT waiting to be asked.

- Bootstrap once, from files: to ground a fresh store, call `bootstrap` with the content of files the user already has — SQL, dbt models, `CLAUDE.md` / notes, or a codebook / data dictionary (mapped into the `dictionary` source's rows). YOU read and supply that file content; ClariLayer never connects to or reads the warehouse — it feeds on files, never the data. `bootstrap` ingests analysis artifacts only — when grounding from a repository, save its engineering context (decisions, constraints, incident lessons) through `remember`, one entry each.
- Recall first: before writing SQL, defining or computing a metric, making an engineering decision, or answering a question about this data or codebase, call `get_analysis_context` (pass a `use_case`). Build on what is already known instead of re-deriving it. Recall returns display-capped previews — when you need an entry's full stored content (its complete body, CRM contract, or saved SQL), fetch it with `get_context_entry` (type + name). A `has_crm_contract:true` marker always requires that full fetch.
- Write back as you learn: when you establish a durable fact — a definition, row-free CRM contract, schema note, reusable query (attach the SELECT as `sql`), assumption, caveat, or decision — save it with `remember`. Save an engineering decision, constraint, or incident lesson as a `definition` carrying the strict `engineering` object (its `kind`, `scope_paths`, and repository `source` pointer; it cannot be combined with `sql`, `metric`, `crm`, or `reasoning`). In a CRM declaration, `expected_values` and `canonical_value.value` assert positive record usage; never repeat the canonical value in `expected_values`; deprecated aliases are conflict candidates, and labels are checked against option metadata. Use `propose` for suggestions (they go to the human's review inbox; `propose` cannot carry the `engineering` object — confirm an engineering suggestion with the user, then save it with `remember`).
- Harvest only when asked: if (and only if) the user asks you to learn from this conversation, stage the durable facts via ONE `propose_batch` call with `provenance: "agent"` and review them in the Inbox — never ambiently, never auto-accepted; the raw transcript is never sent, only the distilled candidates.
- Reconcile on drift: if a definition's SQL changed, staleness is flagged, or a HubSpot CRM contract needs checking, call `reconcile` with warehouse shape or bounded row-free `crm_evidence` metadata and distributions. Configured-but-unused means absent or exact-zero in a complete record distribution, not absent from provider metadata; incomplete evidence stays asserted-only. Use your own provider access; never send CRM rows or credentials. Salesforce reconcile is disabled.
- Stay honest: treat status as `asserted`/`caveat`, never `verified`.
```

## Check your dbt docs against the warehouse

<!-- DRAFT — founder copy review pending (D-002) -->

New in 0.2.0: the same CLI can check a dbt project's YAML docs against what the warehouse actually reported — **locally, read-only, no account needed**. It compares the two files `dbt docs generate` already writes (`target/manifest.json` vs `target/catalog.json`) and lists the drift:

```bash
cd your-dbt-project
dbt docs generate
npx clarilayer dbt-check
```

- **Phantom columns** — documented in YAML, missing from the warehouse (with rename candidates).
- **Models never built** — documented, but no relation in the warehouse.
- **Type family mismatches** — the declared type family differs from the warehouse's (conservatively matched).
- **Hollow descriptions** — declared columns whose description is empty.
- Plus a not-checked disclosure and a coverage line. `--md report.md` writes the full report; `--json` gives machine output on a pure stdout.

With `--save`, the findings become the on-ramp to the context layer: it stages the top finding-bearing objects — a documented column or model with its drift findings — as **proposals** in your ClariLayer Context Inbox, where you review each one before it lands; accepted items become `asserted` entries your agent recalls from then on. Your dbt artifacts never leave your machine: only the selected findings' bounded metadata is sent, and `--save --dry-run` shows you the exact payload with zero network.

Full reference: [CLI.md](./CLI.md) · Guide: [clarilayer.com/docs/guides/dbt-check](https://clarilayer.com/docs/guides/dbt-check)

## Propose before you save, and harvest a working session

Not every fact should write straight to your context. Two verbs put a human in the loop:

- **propose** stages *one* suggested entry in your **Context Inbox**. It stays pending until you accept it — it is never auto-saved and never recalled while it sits there.
- **propose_batch** is the bulk form: up to ~25 candidate entries in a single call, all landing in the same inbox for review.

**Conversation harvest** builds on `propose_batch`. When you *explicitly ask*, your agent distills the durable facts from a working conversation — the definitions, gotchas, and decisions you settled during the session — into a handful of candidates and stages them for your review. The guardrails are deliberate:

- **Explicit request only** — harvesting never runs in the background or ambiently; you have to ask for it.
- **You approve each candidate** — nothing enters your context until you accept it from the inbox.
- **Your transcript is never sent to ClariLayer** — only the distilled candidate facts cross the boundary, not the conversation itself.
- Harvested candidates carry provenance **`agent`** (they're the agent's suggestion, not your authorship) and remain `asserted`/`caveat` once accepted — never "verified".

`propose`, `propose_batch`, and harvest are all on the **free** single-player tier, alongside recall, remember, bootstrap, and reconcile.

## Tidy the reasoning on an entry — reversibly

Caveats and assumptions attached to an entry have their own lifecycle, so you can quietly retire a note without losing the history:

- **archive_reasoning** reversibly hides an attached caveat/assumption — it stops being recalled but is kept as history.
- **restore_reasoning** brings an archived one back.
- **forget_reasoning** deletes one permanently.

(Entries themselves have the matching `archive` / `restore` / `forget`.)

## What makes it different from a plain `CLAUDE.md`

`reconcile`. A saved definition isn't just trusted — your agent runs its SQL against your warehouse and reports the result shape back, and ClariLayer compares declared-vs-actual. A mismatch becomes a **caveat** so you and your agent know exactly what to trust.

> **On trust language — we keep it honest.** ClariLayer's two statuses are **`asserted`** and **`caveat`** — a clean reconcile stays `asserted`, and ClariLayer never stamps **`verified`**. We reconcile and flag caveats; we don't claim your context is "verified." ([why](https://clarilayer.com/docs))

## Your data stays yours

**ClariLayer never holds your warehouse credentials and never executes SQL server-side.** Your agent is the connector — it runs queries with its own access and sends back result metadata plus any optional preview rows *it* chooses to include. ClariLayer stores the context, not your warehouse keys.

## Pricing

**Free for individuals** — install, recall, remember, bootstrap, reconcile, propose / propose_batch, and conversation harvest are unmetered for single-player use. Team-merge, governance, and the Contract API are the secondary *for teams* expansion strand. See **[clarilayer.com/pricing](https://clarilayer.com/pricing)**.

## Get started

1. **[Sign up free →](https://clarilayer.com/auth/sign-up)**
2. Open **Connect your AI** and mint a context key
3. Paste the install command for your agent (above)
4. In your next session, ask your agent to `bootstrap` from your `./sql` folder — then watch the first `reconcile`. In a code repo instead? Ask it to save the repo's key engineering decisions, constraints, and incident lessons with `remember`

## FAQ

**Is this open source?**
This repo — the docs, examples, and the thin setup CLI (`npx clarilayer init`) — is MIT licensed. The **ClariLayer service itself is hosted and proprietary**; you connect to it with a free account. This repo is the front door, not the product source.

**Where does my data go?**
Your context (definitions, notes, SQL you choose to save) is stored in your ClariLayer account. Your warehouse credentials are never sent to ClariLayer, and ClariLayer never runs SQL against your warehouse — your agent does that locally. See [Your data stays yours](#your-data-stays-yours).

**Which agents are supported?**
Claude Code, Cursor, Codex, and claude.ai today — anything that speaks MCP over Streamable HTTP. The coding agents connect with a context key (see [Install](#install)); claude.ai connects as a custom connector over OAuth — no `cl_…` key.

**I have a team / need governance.**
That's the *for teams* strand — ownership, approvals, the one right metric, and the Contract API. Start [here](https://clarilayer.com/use-cases).

---

<p align="center">
  <sub>Built for analysts who live in their AI agent. · <a href="https://clarilayer.com">clarilayer.com</a></sub>
</p>
