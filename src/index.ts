#!/usr/bin/env node
/**
 * clarilayer — connect ClariLayer to your AI coding agent.
 *
 * Bare `clarilayer` (or `clarilayer init`) runs the interactive connect flow.
 * `clarilayer dbt-check` runs the local docs-vs-warehouse drift check.
 */
import { createRequire } from "node:module";
import { runDbtCheck } from "./commands/dbt-check.js";
import { runInit, type InitOptions } from "./commands/init.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const HELP = `clarilayer — connect your durable context layer for analytical and engineering work to your AI agent

Usage
  npx clarilayer [init] [options]       Connect ClariLayer to your AI agent
  npx clarilayer dbt-check [options]    Check dbt YAML docs against the warehouse catalog

Init options
  --key <cl_...>     Use this context key (or set CLARILAYER_CONTEXT_KEY)
  --agent <id>       Only configure one agent: claude-code | cursor | codex
  --open             Offer to open the browser to mint a key
  --no-stanza        Don't offer to add the CLAUDE.md standing-orders block
  --skip-verify      Don't check the key against clarilayer.com
  --dry-run          Show what would happen; write nothing
  -y, --yes          Non-interactive: accept defaults, auto-detect agents
  -v, --version      Print version
  -h, --help         Show this help

dbt-check options
  --project-dir <dir>      dbt project directory (default: current directory)
  --target-path <dir>      dbt artifacts directory (default: <project-dir>/target)
  --md <file>              Also write the full drift report as markdown to <file>
  --top <n>                Findings shown per section in the terminal (default: 10)
  --json                   Print the full report as JSON on stdout; status goes to stderr
  --max-artifact-mb <n>    Per-artifact size cap in MB (default: 300)

dbt-check compares your dbt YAML docs (manifest.json) against what the warehouse
reported (catalog.json, from "dbt docs generate") and lists the drift findings.
Local and read-only: nothing is uploaded, nothing leaves your machine.

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

interface ParsedDbtCheckArgs {
  help: boolean;
  json: boolean;
  projectDir?: string;
  targetPath?: string;
  md?: string;
  top?: number;
  maxArtifactMb?: number;
  /** First usage problem hit (unknown argument, missing value); parse keeps going. */
  problem?: string;
}

/** Hand-rolled, same style as parseArgs; numeric bounds live in runDbtCheck. */
function parseDbtCheckArgs(rest: string[]): ParsedDbtCheckArgs {
  const o: ParsedDbtCheckArgs = { help: false, json: false };
  const flagProblem = (message: string): void => {
    o.problem = o.problem ?? message;
  };
  const value = (flag: string, raw: string | undefined): string => {
    if (raw === undefined || raw === "") flagProblem(`${flag} requires a value`);
    return raw ?? "";
  };
  const numeric = (flag: string, raw: string | undefined): number => {
    const text = value(flag, raw);
    // Number("") is 0 — an empty value must fail the bound check, not pass it.
    return text.trim() === "" ? Number.NaN : Number(text);
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "-h" || a === "--help") o.help = true;
    else if (a === "--json") o.json = true;
    else if (a === "--project-dir") o.projectDir = value(a, rest[++i]);
    else if (a.startsWith("--project-dir=")) o.projectDir = value("--project-dir", a.slice("--project-dir=".length));
    else if (a === "--target-path") o.targetPath = value(a, rest[++i]);
    else if (a.startsWith("--target-path=")) o.targetPath = value("--target-path", a.slice("--target-path=".length));
    else if (a === "--md") o.md = value(a, rest[++i]);
    else if (a.startsWith("--md=")) o.md = value("--md", a.slice("--md=".length));
    else if (a === "--top") o.top = numeric(a, rest[++i]);
    else if (a.startsWith("--top=")) o.top = numeric("--top", a.slice("--top=".length));
    else if (a === "--max-artifact-mb") o.maxArtifactMb = numeric(a, rest[++i]);
    else if (a.startsWith("--max-artifact-mb=")) o.maxArtifactMb = numeric("--max-artifact-mb", a.slice("--max-artifact-mb=".length));
    else flagProblem(`Unexpected dbt-check argument: ${a}`);
  }
  return o;
}

/** dbt-check exit codes: 0 = ran, 2 = usage or artifact problem. Nothing else. */
function runDbtCheckCommand(rest: string[]): number {
  const o = parseDbtCheckArgs(rest);
  if (o.help) {
    console.log(HELP);
    return 0;
  }
  if (o.problem !== undefined) {
    console.error(`${o.problem}\n\nUsage: npx clarilayer dbt-check [options] — run "npx clarilayer --help" for the option list.`);
    return 2;
  }
  try {
    return runDbtCheck({
      projectDir: o.projectDir,
      targetPath: o.targetPath,
      md: o.md,
      top: o.top,
      json: o.json,
      maxArtifactMb: o.maxArtifactMb,
    });
  } catch (err) {
    // runDbtCheck reports expected failures itself; this last-resort net
    // keeps the exit-code contract at 0-or-2 even for unexpected throws.
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === "dbt-check") {
    process.exitCode = runDbtCheckCommand(argv.slice(1));
    return;
  }

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
  if (o.command === "dbt-check") {
    // Reached only when init-style flags preceded the subcommand; dbt-check
    // parses its own flags, so it has to come first.
    console.error(`Put the subcommand first: npx clarilayer dbt-check [options]\n`);
    process.exitCode = 2;
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
