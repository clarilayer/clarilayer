/**
 * Canonical connection constants.
 *
 * Project instructions are obtained by the connected agent through
 * get_project_stanza. Do not embed the runtime workflow in this package.
 */

/** Stable server name the user's agent registers the connection under. */
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
