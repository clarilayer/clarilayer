#!/usr/bin/env node
/**
 * clarilayer — connect ClariLayer to your AI coding agent.
 *
 * Bare `clarilayer` (or `clarilayer init`) runs the interactive connect flow.
 * `clarilayer dbt-check` runs the local docs-vs-warehouse drift check.
 */
import { createRequire } from "node:module";
import { runDbtCheck, type DbtCheckOptions } from "./commands/dbt-check.js";
import { runInit, type InitOptions } from "./commands/init.js";
import { DEFAULT_MAX_ARTIFACT_BYTES } from "./lib/dbt/load.js";
import { DEFAULT_TOP_PER_SECTION } from "./lib/dbt/render-tty.js";
import { DEFAULT_SAVE_TOP, MAX_SAVE_FINDING_OBJECTS } from "./lib/save.js";

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
  --top <n>                Findings shown per section in the terminal (default: ${DEFAULT_TOP_PER_SECTION})
  --json                   Print the full report as JSON on stdout; status goes to stderr
  --max-artifact-mb <n>    Per-artifact size cap in MB (default: ${DEFAULT_MAX_ARTIFACT_BYTES / (1024 * 1024)})
  --save                   Stage top findings as proposals in your ClariLayer Context Inbox
  --save-top <n>           Drift objects staged with --save (default: ${DEFAULT_SAVE_TOP}, max ${MAX_SAVE_FINDING_OBJECTS})
  --key <cl_...>           Context key for --save (or set CLARILAYER_CONTEXT_KEY)
  --dry-run                With --save: print the exact request body on stdout; send nothing

dbt-check compares your dbt YAML docs (manifest.json) against what the warehouse
reported (catalog.json, from "dbt docs generate") and lists the drift findings.
Local and read-only by default: nothing leaves your machine. With --save, only
the staged proposals are sent — to your ClariLayer Context Inbox, where you
review each one before it lands.

Get a free key: https://clarilayer.com/auth/sign-up  →  Connect your AI
Docs:           https://clarilayer.com/docs`;

interface ParsedArgs extends Omit<InitOptions, "version"> {
  command: string;
  help: boolean;
  showVersion: boolean;
  unknown?: string;
}

/** Init-flow arguments; takes argv already sliced past the node/script entries. */
function parseArgs(rest: string[]): ParsedArgs {
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

interface ParsedDbtCheckArgs extends DbtCheckOptions {
  help: boolean;
  json: boolean;
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
    // --help, --json, --save, and --dry-run take no value, so their `=`
    // forms fall through to the unexpected-argument default below.
    if (a === "-h" || a === "--help") {
      o.help = true;
      continue;
    }
    if (a === "--json") {
      o.json = true;
      continue;
    }
    if (a === "--save") {
      o.save = true;
      continue;
    }
    if (a === "--dry-run") {
      o.dryRun = true;
      continue;
    }
    const eq = a.indexOf("=");
    const flag = eq === -1 ? a : a.slice(0, eq);
    /** Inline `--flag=value` payload, or the next argument (consumed only on use). */
    const raw = (): string | undefined => (eq === -1 ? rest[++i] : a.slice(eq + 1));
    switch (flag) {
      case "--project-dir": o.projectDir = value(flag, raw()); break;
      case "--target-path": o.targetPath = value(flag, raw()); break;
      case "--md": o.md = value(flag, raw()); break;
      case "--top": o.top = numeric(flag, raw()); break;
      case "--max-artifact-mb": o.maxArtifactMb = numeric(flag, raw()); break;
      case "--save-top": o.saveTop = numeric(flag, raw()); break;
      case "--key": o.key = value(flag, raw()); break;
      default: flagProblem(`Unexpected dbt-check argument: ${a}`);
    }
  }
  // Cross-flag usage: the save-only flags mean nothing without --save, and a
  // silent no-op would be worse than a refusal.
  if (o.save !== true) {
    if (o.dryRun === true) flagProblem("--dry-run requires --save (it previews the exact staged payload without sending it)");
    if (o.saveTop !== undefined) flagProblem("--save-top requires --save");
    if (o.key !== undefined) flagProblem("--key requires --save");
  }
  return o;
}

/** dbt-check exit codes: 0 = ran, 2 = usage/artifact/staging problem. Nothing else. */
async function runDbtCheckCommand(rest: string[]): Promise<number> {
  const { help, problem, ...options } = parseDbtCheckArgs(rest);
  if (help) {
    // Help is informational: with --json, stdout is reserved for the JSON
    // document alone, so the help text goes to stderr there.
    if (options.json) console.error(HELP);
    else console.log(HELP);
    return 0;
  }
  if (problem !== undefined) {
    console.error(`${problem}\n\nUsage: npx clarilayer dbt-check [options] — run "npx clarilayer --help" for the option list.`);
    return 2;
  }
  try {
    return await runDbtCheck({ ...options, version: pkg.version });
  } catch (err) {
    // runDbtCheck reports expected failures itself; this last-resort net
    // keeps the exit-code contract at 0-or-2 even for unexpected throws.
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }
}

/**
 * Subcommands with their own argument parsers. Consulted by both the argv[0]
 * dispatch and the misplaced-subcommand diagnostic in main(), so the two can
 * never disagree about what counts as a subcommand.
 */
const SUBCOMMANDS = new Map<string, (rest: string[]) => number | Promise<number>>([
  ["dbt-check", runDbtCheckCommand],
]);

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const subcommand = SUBCOMMANDS.get(argv[0] ?? "");
  if (subcommand !== undefined) {
    process.exitCode = await subcommand(argv.slice(1));
    return;
  }

  const o = parseArgs(argv);

  if (o.showVersion) {
    console.log(pkg.version);
    return;
  }
  if (o.help) {
    console.log(HELP);
    return;
  }
  if (SUBCOMMANDS.has(o.command)) {
    // Flags preceded the subcommand — init-style or unknown alike, checked
    // before the unknown-option branch so both orderings get this same
    // diagnostic. A subcommand parses its own flags, so it has to come first.
    console.error(`Put the subcommand first: npx clarilayer ${o.command} [options]\n`);
    process.exitCode = 2;
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
