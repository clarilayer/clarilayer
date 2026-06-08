/**
 * `clarilayer init` — connect ClariLayer to your AI agent(s).
 *
 * Flow: get a context key (flag / env / prompt) → optionally validate it →
 * pick agents → write each agent's MCP config → optionally drop the CLAUDE.md
 * stanza → print next steps. Honest by construction: it never claims more than
 * the shipped product does.
 */
import { spawn } from "node:child_process";
import {
  intro,
  outro,
  text,
  multiselect,
  confirm,
  spinner,
  isCancel,
  cancel,
  note,
  log,
} from "@clack/prompts";
import {
  CONNECT_URL,
  DOCS_URL,
  SIGNUP_URL,
  keyLooksValid,
} from "../lib/constants.js";
import { configureAgent, detectAgents, type AgentId, type ConfigureResult } from "../lib/agents.js";
import { validateKey } from "../lib/validate.js";
import { writeStanza } from "../lib/stanza.js";

export interface InitOptions {
  key?: string;
  agent?: string;
  dryRun: boolean;
  yes: boolean;
  skipVerify: boolean;
  stanza: boolean;
  open: boolean;
  version: string;
}

const ALL_AGENTS: AgentId[] = ["claude-code", "cursor", "codex"];

function bail(message: string): never {
  cancel(message);
  process.exit(1);
}

function openUrl(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    /* opening the browser is a convenience; ignore failures */
  }
}

async function resolveKey(opts: InitOptions): Promise<string> {
  const fromFlagOrEnv = opts.key || process.env.CLARILAYER_CONTEXT_KEY;
  if (fromFlagOrEnv) {
    if (!keyLooksValid(fromFlagOrEnv)) {
      bail(`That key doesn't look like a ClariLayer context key (expected "cl_…"). Get one at ${CONNECT_URL}`);
    }
    return fromFlagOrEnv.trim();
  }

  if (opts.yes) {
    bail(`No context key provided. Pass --key cl_… or set CLARILAYER_CONTEXT_KEY. Mint one at ${CONNECT_URL}`);
  }

  note(
    `You'll need a free context key.\n\n1. Sign up:    ${SIGNUP_URL}\n2. Open "Connect your AI" and mint a key (shown once)\n3. Paste it below`,
    "Get your key",
  );

  if (opts.open) {
    const go = await confirm({ message: `Open ${CONNECT_URL} in your browser now?` });
    if (isCancel(go)) bail("Cancelled.");
    if (go) openUrl(CONNECT_URL);
  }

  const entered = await text({
    message: "Paste your ClariLayer context key",
    placeholder: "cl_…",
    validate: (value) => (keyLooksValid(value) ? undefined : 'Should start with "cl_".'),
  });
  if (isCancel(entered)) bail("Cancelled.");
  return entered.trim();
}

async function resolveAgents(opts: InitOptions): Promise<AgentId[]> {
  if (opts.agent) {
    if (!ALL_AGENTS.includes(opts.agent as AgentId)) {
      bail(`Unknown --agent "${opts.agent}". Use one of: ${ALL_AGENTS.join(", ")}`);
    }
    return [opts.agent as AgentId];
  }

  const detected = detectAgents();
  if (opts.yes) {
    const auto = detected.filter((a) => a.detected).map((a) => a.id);
    return auto.length ? auto : ALL_AGENTS;
  }

  const selected = await multiselect({
    message: "Which agent(s) should I connect?",
    options: detected.map((a) => ({ value: a.id, label: a.label, hint: a.hint })),
    initialValues: detected.filter((a) => a.detected).map((a) => a.id),
    required: true,
  });
  if (isCancel(selected)) bail("Cancelled.");
  return selected as AgentId[];
}

function reportAgent(result: ConfigureResult): void {
  const where = result.path ? ` (${result.path})` : "";
  if (result.status === "configured") {
    log.success(`${result.label}: ${result.detail}${where}`);
  } else if (result.status === "manual") {
    log.warn(`${result.label}: ${result.detail}`);
    if (result.manual) note(result.manual, "Do this manually");
  } else {
    log.error(`${result.label}: ${result.detail}`);
    if (result.manual) note(result.manual, "Run this manually");
  }
}

export async function runInit(opts: InitOptions): Promise<void> {
  intro("ClariLayer — connect your AI");
  if (opts.dryRun) log.info("Dry run: nothing will be written.");

  const key = await resolveKey(opts);

  // Validate the key (best effort; only a hard 401/403 blocks). Skipped on
  // dry runs so the smoke path makes no network calls.
  if (!opts.skipVerify && !opts.dryRun) {
    const s = spinner();
    s.start("Checking your key against clarilayer.com");
    const verdict = await validateKey(key, opts.version);
    if (verdict === "ok") s.stop("Key accepted.");
    else if (verdict === "invalid") {
      s.stop("Key rejected.");
      bail(`That key was rejected (401). Mint a fresh one at ${CONNECT_URL} and try again.`);
    } else s.stop("Couldn't reach clarilayer.com to verify — continuing anyway.");
  }

  const agents = await resolveAgents(opts);
  const results = agents.map((id) => configureAgent(id, key, opts.dryRun));
  results.forEach(reportAgent);

  // Standing-orders stanza for the project's CLAUDE.md.
  if (opts.stanza) {
    let doStanza = true;
    if (!opts.yes) {
      const ans = await confirm({ message: "Add the proactive standing-orders block to ./CLAUDE.md?" });
      if (isCancel(ans)) bail("Cancelled.");
      doStanza = ans;
    }
    if (doStanza) {
      const r = writeStanza(process.cwd(), opts.dryRun);
      if (r.status === "added") log.success(`CLAUDE.md: added the standing-orders block (${r.path})`);
      else if (r.status === "already-present") log.info(`CLAUDE.md: standing-orders block already present (${r.path})`);
      else log.info(`CLAUDE.md: [dry-run] would add the standing-orders block (${r.path})`);
    }
  }

  const anyConfigured = results.some((r) => r.status === "configured");
  if (opts.dryRun) {
    outro("Dry run complete — re-run without --dry-run to apply.");
    return;
  }
  if (anyConfigured) {
    note(
      `1. Restart your agent if it was open.\n2. Ask it to bootstrap: "Bootstrap my ClariLayer context from ./analytics/sql"\n3. Try the hero moment: "Reconcile my net revenue definition against the warehouse"\n\nDocs: ${DOCS_URL}`,
      "Next",
    );
    outro("Connected. Your agent can now recall, remember, bootstrap, and reconcile.");
  } else {
    outro("Finished — follow the manual steps above to complete the connection.");
  }
}
