/**
 * Agent detection + config writers for Claude Code, Cursor, and Codex.
 *
 * Writers are conservative: they MERGE into existing config (never clobber other
 * MCP servers), back up any file they touch, and fall back to printing a manual
 * command/snippet when they can't safely edit.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { MCP_SERVER_NAME, MCP_URL } from "./constants.js";

export type AgentId = "claude-code" | "cursor" | "codex";

export interface AgentInfo {
  id: AgentId;
  label: string;
  hint: string;
  detected: boolean;
}

export type ConfigureStatus = "configured" | "manual" | "error";

export interface ConfigureResult {
  id: AgentId;
  label: string;
  status: ConfigureStatus;
  detail: string;
  path?: string;
  /** A copy-paste fallback shown when status is "manual" or "error". */
  manual?: string;
}

const HOME = homedir();
const CURSOR_CFG = join(HOME, ".cursor", "mcp.json");
const CODEX_CFG = join(HOME, ".codex", "config.toml");

function commandExists(cmd: string): boolean {
  const probe = process.platform === "win32" ? "where" : "which";
  const res = spawnSync(probe, [cmd], { stdio: "ignore" });
  return res.status === 0;
}

export function detectAgents(): AgentInfo[] {
  return [
    {
      id: "claude-code",
      label: "Claude Code",
      hint: commandExists("claude") ? "claude CLI found" : "claude CLI not on PATH",
      detected: commandExists("claude"),
    },
    {
      id: "cursor",
      label: "Cursor",
      hint: existsSync(join(HOME, ".cursor")) ? "~/.cursor found" : "~/.cursor not found",
      detected: existsSync(join(HOME, ".cursor")),
    },
    {
      id: "codex",
      label: "Codex",
      hint: existsSync(join(HOME, ".codex")) ? "~/.codex found" : "~/.codex not found",
      detected: existsSync(join(HOME, ".codex")),
    },
  ];
}

const LABELS: Record<AgentId, string> = {
  "claude-code": "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
};

function authHeader(key: string): string {
  return `Authorization: Bearer ${key}`;
}

function backup(path: string): void {
  if (existsSync(path)) copyFileSync(path, `${path}.bak`);
}

function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

/** Claude Code: shell out to the official `claude mcp add` (the verified form). */
function configureClaudeCode(key: string, dryRun: boolean): ConfigureResult {
  const args = [
    "mcp",
    "add",
    "--transport",
    "http",
    MCP_SERVER_NAME,
    MCP_URL,
    "--header",
    authHeader(key),
  ];
  const manual = `claude mcp add --transport http ${MCP_SERVER_NAME} ${MCP_URL} --header "${authHeader(key)}"`;

  if (!commandExists("claude")) {
    return {
      id: "claude-code",
      label: LABELS["claude-code"],
      status: "manual",
      detail: "Claude CLI not found on PATH — run this once it's installed:",
      manual,
    };
  }
  if (dryRun) {
    return {
      id: "claude-code",
      label: LABELS["claude-code"],
      status: "configured",
      detail: "[dry-run] would run: claude mcp add …",
    };
  }
  const res = spawnSync("claude", args, { encoding: "utf8" });
  if (res.status === 0) {
    return { id: "claude-code", label: LABELS["claude-code"], status: "configured", detail: "Registered via claude mcp add." };
  }
  const stderr = (res.stderr || "").trim();
  const already = /already exists/i.test(stderr);
  return {
    id: "claude-code",
    label: LABELS["claude-code"],
    status: already ? "manual" : "error",
    detail: already
      ? "A 'clarilayer' server already exists. Remove it first (claude mcp remove clarilayer), then re-run — or update it manually:"
      : `claude mcp add failed: ${stderr || "unknown error"}. Run manually:`,
    manual,
  };
}

/** Cursor: merge into ~/.cursor/mcp.json without disturbing other servers. */
function configureCursor(key: string, dryRun: boolean): ConfigureResult {
  const snippet = JSON.stringify(
    { mcpServers: { [MCP_SERVER_NAME]: { url: MCP_URL, headers: { Authorization: `Bearer ${key}` } } } },
    null,
    2,
  );
  if (dryRun) {
    return { id: "cursor", label: LABELS.cursor, status: "configured", detail: `[dry-run] would merge into ${CURSOR_CFG}`, path: CURSOR_CFG };
  }

  let config: Record<string, unknown> = {};
  if (existsSync(CURSOR_CFG)) {
    try {
      config = JSON.parse(readFileSync(CURSOR_CFG, "utf8") || "{}") as Record<string, unknown>;
    } catch {
      return {
        id: "cursor",
        label: LABELS.cursor,
        status: "manual",
        detail: `${CURSOR_CFG} isn't valid JSON — didn't touch it. Add this block yourself:`,
        manual: snippet,
        path: CURSOR_CFG,
      };
    }
  }

  const servers = (config.mcpServers && typeof config.mcpServers === "object" ? config.mcpServers : {}) as Record<string, unknown>;
  servers[MCP_SERVER_NAME] = { url: MCP_URL, headers: { Authorization: `Bearer ${key}` } };
  config.mcpServers = servers;

  ensureDir(CURSOR_CFG);
  backup(CURSOR_CFG);
  writeFileSync(CURSOR_CFG, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { id: "cursor", label: LABELS.cursor, status: "configured", detail: "Merged into your Cursor MCP config. Restart Cursor.", path: CURSOR_CFG };
}

/**
 * Codex: append the [mcp_servers.clarilayer] block to ~/.codex/config.toml.
 * We append text (rather than parse → re-serialize) to preserve the user's
 * comments and formatting. If a clarilayer block already exists we don't guess —
 * we print the block for manual replacement.
 */
function configureCodex(key: string, dryRun: boolean): ConfigureResult {
  const block = [
    `[mcp_servers.${MCP_SERVER_NAME}]`,
    `command = "npx"`,
    `args = ["-y", "mcp-remote", "${MCP_URL}", "--header", "${authHeader(key)}"]`,
  ].join("\n");

  if (dryRun) {
    return { id: "codex", label: LABELS.codex, status: "configured", detail: `[dry-run] would append to ${CODEX_CFG}`, path: CODEX_CFG };
  }

  const existing = existsSync(CODEX_CFG) ? readFileSync(CODEX_CFG, "utf8") : "";
  if (existing.includes(`[mcp_servers.${MCP_SERVER_NAME}]`)) {
    return {
      id: "codex",
      label: LABELS.codex,
      status: "manual",
      detail: `A [mcp_servers.${MCP_SERVER_NAME}] block already exists in ${CODEX_CFG}. Replace it with:`,
      manual: block,
      path: CODEX_CFG,
    };
  }

  ensureDir(CODEX_CFG);
  backup(CODEX_CFG);
  const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  writeFileSync(CODEX_CFG, `${existing}${sep}${existing.length ? "\n" : ""}${block}\n`, "utf8");
  return { id: "codex", label: LABELS.codex, status: "configured", detail: "Appended to your Codex config.", path: CODEX_CFG };
}

export function configureAgent(id: AgentId, key: string, dryRun: boolean): ConfigureResult {
  switch (id) {
    case "claude-code":
      return configureClaudeCode(key, dryRun);
    case "cursor":
      return configureCursor(key, dryRun);
    case "codex":
      return configureCodex(key, dryRun);
  }
}
