# Contributing

Thanks for your interest! First, a quick scope note so we don't waste your time.

## What this repo is

This is the **front door** to ClariLayer — the docs, examples, recipes, and the thin setup CLI (`npx clarilayer init`) that help you connect your AI agent to the hosted ClariLayer MCP server.

**It is not the product source.** The ClariLayer service — the MCP server, app, and data platform — is hosted and proprietary at [clarilayer.com](https://clarilayer.com). We won't be able to accept pull requests that assume the server is open source.

## What we'd genuinely love

- **Bug reports on setup** — an install command that didn't work, a client we don't cover well, a confusing step. Open a [connection-help issue](https://github.com/clarilayer/clarilayer/issues/new?template=connection-help.md).
- **Recipe contributions** — a general-work recall/save/correction flow or an Analytics `bootstrap` / `reconcile` workflow that worked well for you. PRs to `recipes/` welcome.
- **Doc fixes** — typos, broken links, clearer wording.
- **Feature ideas for the product** — [open a feature request](https://github.com/clarilayer/clarilayer/issues/new?template=feature-request.md). It feeds our roadmap.

## A truthfulness ground rule

ClariLayer is a trust product, so the docs hold a hard line: the only context statuses are **`asserted`** and **`caveat`** — ClariLayer does not stamp **`verified`**. Please don't add copy that describes context as "verified," or that promises a "verified" status is coming. If a change implies it, we'll ask you to reword it.

## Talking to us

- Setup help / bugs → GitHub issues
- Anything else → **support@clarilayer.com**

## Keeping the public surface current

When the hosted product changes its public workflow, update this repo's README, Quickstart, capability snapshot, setup examples, recipes and `server.json` together. Check the live MCP `capabilities` output for server/capability versions and tool names; record the observation date. Refresh GitHub's repository description when positioning changes. The MCP registry descriptor in git is separate from publication to any external registry.

Keep the CLI's instruction handoff small. Check its client IDs, target filenames, `client_targets`, `managed_block`, `managed_apply_guidance` and runtime/full modes against the live server contract at release. The connected AI must obtain the current install contract and runtime workflow from `get_project_stanza`; do not add another embedded product workflow or infer installation freshness from an old heading. Preserve the one-client/one-project target boundary and separate setup evidence from actual context use.

Source changes do not publish an npm package. Keep the release-status notes in README, CLI.md and CHANGELOG truthful until the founder completes [RELEASING.md](./RELEASING.md).

## Local validation

```bash
npm ci
npm run build
npm run typecheck
npm test
npm pack --dry-run
```

The suite covers CLI parsing, the instruction handoff, existing dbt reports and proposal payloads. It does not establish that every AI host will execute a printed request correctly; review actual client results separately.
