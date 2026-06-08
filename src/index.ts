#!/usr/bin/env node
/**
 * clarilayer — connect ClariLayer to your AI coding agent.
 *
 * Bare `clarilayer` (or `clarilayer init`) runs the interactive connect flow.
 */
import { createRequire } from "node:module";
import { runInit, type InitOptions } from "./commands/init.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const HELP = `clarilayer — connect the individual-analyst context layer to your AI agent

Usage
  npx clarilayer [init] [options]

Options
  --key <cl_...>     Use this context key (or set CLARILAYER_CONTEXT_KEY)
  --agent <id>       Only configure one agent: claude-code | cursor | codex
  --open             Offer to open the browser to mint a key
  --no-stanza        Don't offer to add the CLAUDE.md standing-orders block
  --skip-verify      Don't check the key against clarilayer.com
  --dry-run          Show what would happen; write nothing
  -y, --yes          Non-interactive: accept defaults, auto-detect agents
  -v, --version      Print version
  -h, --help         Show this help

Get a free key: https://clarilayer.com/auth/sign-up  →  Connect your AI
Docs:           https://clarilayer.com/docs`;

interface ParsedArgs extends Omit<InitOptions, "version"> {
  command: string;
  help: boolean;
  showVersion: boolean;
  unknown?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const o: ParsedArgs = {
    command: "",
    help: false,
    showVersion: false,
    dryRun: false,
    yes: false,
    skipVerify: false,
    stanza: true,
    open: false,
  };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "-h" || a === "--help") o.help = true;
    else if (a === "-v" || a === "--version") o.showVersion = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "-y" || a === "--yes") o.yes = true;
    else if (a === "--skip-verify") o.skipVerify = true;
    else if (a === "--no-stanza") o.stanza = false;
    else if (a === "--open") o.open = true;
    else if (a === "--agent") o.agent = rest[++i];
    else if (a.startsWith("--agent=")) o.agent = a.slice("--agent=".length);
    else if (a === "--key") o.key = rest[++i];
    else if (a.startsWith("--key=")) o.key = a.slice("--key=".length);
    else if (!a.startsWith("-") && !o.command) o.command = a;
    else o.unknown = a;
  }
  return o;
}

async function main(): Promise<void> {
  const o = parseArgs(process.argv);

  if (o.showVersion) {
    console.log(pkg.version);
    return;
  }
  if (o.help) {
    console.log(HELP);
    return;
  }
  if (o.unknown) {
    console.error(`Unknown option: ${o.unknown}\n`);
    console.log(HELP);
    process.exitCode = 1;
    return;
  }
  if (o.command && o.command !== "init") {
    console.error(`Unknown command: ${o.command}\n`);
    console.log(HELP);
    process.exitCode = 1;
    return;
  }

  await runInit({
    key: o.key,
    agent: o.agent,
    dryRun: o.dryRun,
    yes: o.yes,
    skipVerify: o.skipVerify,
    stanza: o.stanza,
    open: o.open,
    version: pkg.version,
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
