/**
 * Append the standing-orders stanza to the project's CLAUDE.md so the agent
 * uses ClariLayer proactively. Idempotent: if the stanza is already present we
 * leave the file alone.
 */
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { RECOMMENDED_AGENT_STANZA, STANZA_MARKER } from "./constants.js";

export type StanzaStatus = "added" | "already-present" | "dry-run";

export interface StanzaResult {
  status: StanzaStatus;
  path: string;
}

export function writeStanza(cwd: string, dryRun: boolean, fileName = "CLAUDE.md"): StanzaResult {
  const path = join(cwd, fileName);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";

  if (existing.includes(STANZA_MARKER)) {
    return { status: "already-present", path };
  }
  if (dryRun) {
    return { status: "dry-run", path };
  }

  if (existsSync(path)) copyFileSync(path, `${path}.bak`);
  const sep = existing.length === 0 ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  writeFileSync(path, `${existing}${sep}${RECOMMENDED_AGENT_STANZA}\n`, "utf8");
  return { status: "added", path };
}
