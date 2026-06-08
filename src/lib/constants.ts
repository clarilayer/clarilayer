/**
 * Canonical connection constants.
 *
 * These mirror the product's single source of truth in
 * `apps/web/lib/mcp/install-commands.ts` (buildInstallCommands /
 * RECOMMENDED_AGENT_STANZA). Keep them in lockstep — if the shipped MCP
 * endpoint, server name, or stanza changes, update here too. (Future: fetch
 * these from a public install-info endpoint so they can never drift.)
 */

/** Stable server name the analyst's agent registers the connection under. */
export const MCP_SERVER_NAME = "clarilayer";

/** The hosted, stateless Streamable-HTTP MCP endpoint (POST). */
export const MCP_URL = "https://clarilayer.com/api/mcp/mcp";

/** Obviously-fake placeholder so a half-finished command fails loudly. */
export const SECRET_PLACEHOLDER = "cl_YOUR_CONTEXT_KEY";

export const CONNECT_URL = "https://clarilayer.com/connect-ai";
export const SIGNUP_URL = "https://clarilayer.com/auth/sign-up";
export const DOCS_URL = "https://clarilayer.com/docs";

/** Context keys are minted as `cl_…`. A cheap, offline sanity check. */
export function keyLooksValid(key: string): boolean {
  return /^cl_[A-Za-z0-9._-]{8,}$/.test(key.trim());
}

/**
 * The standing-orders block pasted into a project's CLAUDE.md / AGENTS.md so the
 * agent reaches for ClariLayer proactively. Verbatim copy of
 * RECOMMENDED_AGENT_STANZA. Truthful by construction: asserted/caveat only,
 * never "verified".
 */
export const RECOMMENDED_AGENT_STANZA = `## ClariLayer — your data context layer (use it proactively)

ClariLayer is connected over MCP and holds this project's durable data context: definitions, schema notes, reusable SQL, assumptions, caveats, and decisions. Use it WITHOUT waiting to be asked.

- Recall first: before writing SQL, defining or computing a metric, or answering a question about this data, call \`get_analysis_context\` (pass a \`use_case\`). Build on what is already known instead of re-deriving it.
- Write back as you learn: when you establish a durable fact — a definition, schema note, reusable query (attach the SELECT as \`sql\`), assumption, caveat, or decision — save it with \`remember\`. Use \`propose\` for suggestions (they go to the human's review inbox).
- Reconcile on drift: if a definition's SQL changed or staleness is flagged, call \`reconcile\` to check it against the warehouse.
- Stay honest: treat status as \`asserted\`/\`caveat\`, never \`verified\`.`;

/** Marker used to detect the stanza is already present in a CLAUDE.md. */
export const STANZA_MARKER = "## ClariLayer — your data context layer";
