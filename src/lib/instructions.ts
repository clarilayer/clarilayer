/**
 * Secret-free, one-target handoff to the connected local agent. The server owns
 * the versioned install contract and runtime workflow; the CLI never freezes
 * them in a project file or claims a printed request completed an installation.
 */
import type { AgentId } from "./agents.js";

export const INSTRUCTION_TARGETS: Record<AgentId, string> = {
  "claude-code": "CLAUDE.md",
  cursor: ".cursor/rules/clarilayer.mdc",
  codex: "AGENTS.md",
};

export function isInstructionAgent(value: string | undefined): value is AgentId {
  return value !== undefined && Object.hasOwn(INSTRUCTION_TARGETS, value);
}

export function buildInstructionRequest(agent: AgentId): string {
  const target = INSTRUCTION_TARGETS[agent];
  return `Update ClariLayer instructions for ${agent} in this project only.

1. Use the connected ClariLayer MCP server to call get_project_stanza with mode "full". If unavailable, stop the local update, report the gap, and help me refresh the connection. Do not invent or reuse an old workflow.
2. Select only the server's ${agent} target and confirm its target_file is ${target}. Read only that project instruction target. Follow the returned apply guidance and current managed payload, version, hash, markers and required preamble. If the target or contract differs, show the conflict before editing.
3. If there is no target, create it with the returned generic managed_block and required preamble. If an existing target has no ClariLayer markers or legacy sentinel, append that block only as the server guidance permits; an existing Cursor target must already have the exact required preamble. Otherwise replace only an exact recognized ClariLayer managed range or byte-identical published legacy stanza. Preserve all unrelated content and line endings. Do not treat an old heading as proof the instructions are current. For edited, duplicate, malformed, unknown or newer blocks, or non-exact Cursor frontmatter, show a complete proposed diff and ask before changing it. Do not scan or change another client target or project.
4. This CLI request supplies no authenticated Connect project report scope. Use the generic managed_block, without instance metadata. Do not invent project or installation identifiers, remove or rebind a scoped current block, or call sync_instruction_setup. Leave an existing scoped block unchanged and use Connect your AI -> Update my AI setup for that scoped update or reporting step.
5. Before writing, retain the exact surrounding bytes. After writing, re-read the complete target and check that the installed range equals the returned managed_block, its version and hash agree, and all surrounding bytes are unchanged. Only then report installed. Otherwise report already current for an exact no-op or conflict/manual review for a conflict. Report connection, local installation and observed context use separately. A printed request is not an installed file or evidence of recall.

The installed bootstrap should obtain get_project_stanza mode "runtime" once at the first relevant use in each new AI session. Follow its current workflow within my instructions: recall_context before relevant work, remember confirmed durable changes with work_context, and context_checkpoint before completion. Preserve source and applicability. General work and engineering context are not reconciled; live trust statuses are asserted/caveat, never verified.

This request does not authorize history import, capture setup, provider access or semantic-search consent. Those are separate choices.`;
}
