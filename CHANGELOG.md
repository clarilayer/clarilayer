<!-- DRAFT — founder copy review pending (D-002) -->
# Changelog

All notable changes to the `clarilayer` npm package are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html). This file covers the published CLI only; the hosted ClariLayer service versions its MCP contract separately (see [CAPABILITIES.md](./CAPABILITIES.md)).

## [0.2.0] — 2026-08-06

<!-- If the publish date slips, update the date above before running `npm publish` (see RELEASING.md). -->

### Added

- **`clarilayer dbt-check`** — a new subcommand that reads a dbt project's local `target/manifest.json` and `target/catalog.json` (both written by `dbt docs generate`) and reports docs-vs-warehouse drift:
  - **phantom columns** — documented in YAML, missing from the warehouse catalog, with a rename candidate when a close match exists;
  - **models never built** — documented, but no relation in the warehouse;
  - **type family mismatches** — declared type family differs from the warehouse's (conservative: unknown types are never guessed into a family);
  - **hollow descriptions** — declared columns whose description is empty;
  - a **not-checked disclosure** and one **coverage** line, always last.
- Report surfaces: a plain-text terminal report, `--md <file>` for the full markdown report, and `--json` for machine output with a pure stdout (`clarilayer dbt-check --json | jq .` always works; status goes to stderr).
- Supported artifact schemas: manifest v10–v12 (dbt-core 1.7+), catalog v1. Per-artifact size cap of 300 MB, adjustable with `--max-artifact-mb`.
- **`--save`** — stages the top finding-bearing objects (default 10, `--save-top` up to 24; the cap counts objects — a documented column or model with its findings — not raw findings) plus one run summary as **proposals** in your ClariLayer Context Inbox, in a single `propose_batch` call to the hosted MCP endpoint. You review each proposal; accepted items land as `asserted` entries — each drift proposal a schema note, the run summary a plain note — never anything stronger. Supporting flags: `--key` / `CLARILAYER_CONTEXT_KEY`, and `--dry-run` to print the exact would-be request body with zero network (no key needed).
- Privacy boundary: the check itself is local and read-only — artifacts never leave the machine. Only with an explicit `--save` is anything sent, and then only the selected findings' bounded metadata (model/column identity and the drift facts), never the artifacts.

### Security

- The context key is redacted from every terminal-bound line, on failure and success paths alike; a 401 prints fixed local guidance and never relays server-controlled text.
- The `--save` request never follows redirects (`redirect: "error"`), so the bearer key and payload cannot be replayed to an unaudited location.
- Payloads are bounded before any network: per-item (32 KiB) and per-call (200 KiB) size pre-checks run locally, and free-text fields are clipped at build time.

## [0.1.2] — 2026-07-30

- Synced the standing-orders stanza and front-door docs to capability v51; surfaced the Engineering pack (engineering decisions, constraints, incident lessons) in the CLI copy and docs.

## [0.1.1] — 2026-06-09

- Codex now connects to the hosted endpoint directly over HTTP by default (`mcp-remote` becomes the Node-based fallback); updated `server.json` to the current MCP registry schema.

## [0.1.0] — 2026-06-08

- Initial release: `npx clarilayer init` connects ClariLayer to Claude Code, Cursor, and Codex — key validation, non-clobbering MCP config writes with backups, and the optional `CLAUDE.md` standing-orders block.
