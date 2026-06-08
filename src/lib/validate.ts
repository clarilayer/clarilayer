/**
 * Best-effort context-key validation against the live MCP endpoint.
 *
 * We send a minimal JSON-RPC `initialize` with the key as a bearer token. The
 * server's auth runs before request-body handling, so a 401/403 reliably means
 * "bad key". Anything else (2xx, or even a 4xx about the body) means the key was
 * accepted. Network errors are inconclusive — we never block on those.
 */
import { MCP_URL } from "./constants.js";

export type KeyVerdict = "ok" | "invalid" | "unknown";

export async function validateKey(key: string, version: string, timeoutMs = 8000): Promise<KeyVerdict> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "clarilayer-cli", version },
        },
      }),
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) return "invalid";
    if (res.status >= 500) return "unknown";
    return "ok";
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timer);
  }
}
