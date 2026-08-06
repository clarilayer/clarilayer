/**
 * `dbt-check --save` — stage a curated subset of drift findings into the
 * user's ClariLayer Context Inbox as PROPOSALS, one `propose_batch` tool call
 * against the existing hosted MCP endpoint. The user reviews every proposal
 * in the Inbox before anything lands; accepted items land as asserted
 * entries, never anything stronger.
 *
 * Two seams, kept apart on purpose:
 *   - buildSaveItems / buildProposeBatchRequest: pure report → payload
 *     mapping, unit-testable with no network.
 *   - sendProposeBatch: a thin fetch-based MCP client (built-in fetch,
 *     Node >= 18, no SDK). Stateless Streamable-HTTP: exactly ONE JSON-RPC
 *     `tools/call` per POST, no initialize handshake, no retries — every
 *     failure is terminal for the run.
 *
 * The URL, fetch implementation, and timeout are injectable ONLY through
 * sendProposeBatch's options (test seams); MCP_URL stays the single
 * production constant.
 */
import { Buffer } from "node:buffer";
import { CONNECT_URL, MCP_URL } from "./constants.js";
import { KIND_TAGLINES, findingTarget, headline, plural, projectLabel } from "./dbt/render-shared.js";
import {
  FINDING_KIND_SEVERITY_ORDER,
  type DriftFinding,
  type DriftReport,
  type FindingKind,
} from "./dbt/types.js";

// ---------------------------------------------------------------------------
// Server contract constants (verified facts; the server remains the authority)
// ---------------------------------------------------------------------------

/** The one MCP tool this feature calls. */
export const PROPOSE_BATCH_TOOL = "propose_batch";

/** Every staged item carries exactly this provenance. */
export const SAVE_PROVENANCE = "dbt" as const;

/** `body.source_tool` marker on every staged item. */
export const SAVE_SOURCE_TOOL = "clarilayer_dbt_check" as const;

/** Server cap: items per propose_batch call. */
export const MAX_ITEMS_PER_CALL = 25;

/**
 * Hard cap on staged finding objects: the server's 25-item call budget minus
 * the one run-summary note. There is never a second call.
 */
export const MAX_SAVE_FINDING_OBJECTS = MAX_ITEMS_PER_CALL - 1;

/** Default number of finding-bearing objects staged (`--save-top` overrides). */
export const DEFAULT_SAVE_TOP = 10;

/** Server cap: bytes per item (pre-checked locally before sending). */
export const MAX_ITEM_BYTES = 32 * 1024;

/** Server cap: total item bytes per call (pre-checked locally before sending). */
export const MAX_TOTAL_ITEM_BYTES = 200 * 1024;

/** Default network timeout; there are no retries. */
export const DEFAULT_SAVE_TIMEOUT_MS = 10_000;

/** Stable JSON-RPC request id (one request per run, so a constant is fine). */
export const JSONRPC_REQUEST_ID = "dbt-check-save";

/** A usable `--save-top`: a whole number of objects, 1..hard cap. */
export function isValidSaveTop(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= MAX_SAVE_FINDING_OBJECTS;
}

// ---------------------------------------------------------------------------
// Payload shapes
// ---------------------------------------------------------------------------

/**
 * Structured facts for one staged drift object, under `body.dbt_check`.
 * Kept lean by design — identity fields only, no observed-columns arrays.
 */
export interface SaveFindingBody {
  cli_version: string;
  /** Kinds present on this object, in severity order. */
  finding_kinds: FindingKind[];
  model_unique_id: string;
  package_name: string;
  database: string | null;
  schema: string;
  alias: string;
  model: string;
  /** null for model-level findings (model_never_built). */
  column: string | null;
  yaml_path: string | null;
  manifest_schema_version: number;
  /** Rename candidate for a phantom column, when one is close enough. */
  closest_match?: string;
}

/** Structured facts for the one run-summary note. */
export interface SaveSummaryBody {
  cli_version: string;
  project_name: string;
  manifest_schema_version: number;
  finding_counts: Record<FindingKind, number>;
  objects_staged: number;
  objects_total: number;
}

/**
 * One propose_batch item. Exactly these top-level keys — the server rejects
 * unknown top-level item keys (body interior is free).
 */
export interface ProposalItem {
  type: "schema_note" | "note";
  name: string;
  content: string;
  body: {
    source_kind: "dbt";
    source_tool: typeof SAVE_SOURCE_TOOL;
    dbt_check: SaveFindingBody | SaveSummaryBody;
  };
  provenance: typeof SAVE_PROVENANCE;
  rationale: string;
}

/** The exact JSON-RPC POST body — one `tools/call`, never a batch array. */
export interface ProposeBatchRequestBody {
  jsonrpc: "2.0";
  id: string;
  method: "tools/call";
  params: {
    name: typeof PROPOSE_BATCH_TOOL;
    arguments: { items: ProposalItem[] };
  };
}

/** Why an item was excluded locally by the size pre-checks. */
export type LocalSkipReason = "local_item_cap" | "local_total_cap";

export interface SaveItemsBuild {
  /** Finding items in staging order, then the run-summary note, always last. */
  items: ProposalItem[];
  /** Finding-bearing objects eligible after the v0 filter (before any cap). */
  objectsTotal: number;
  /** Finding objects that made it into `items` after caps and size fitting. */
  objectsStaged: number;
  /** Items excluded locally by the size pre-checks, in exclusion order. */
  skippedLocally: Array<{ name: string; reason: LocalSkipReason }>;
}

export interface BuildSaveItemsOptions {
  /** CLI version stamped into every rationale and body (report carries none). */
  cliVersion: string;
  /** Injected clock, so payloads are reproducible in tests. */
  now: Date;
  /** Object cap; defaults to DEFAULT_SAVE_TOP, clamped to the hard cap. */
  saveTop?: number;
}

// ---------------------------------------------------------------------------
// Pure payload builder
// ---------------------------------------------------------------------------

/** Keep free-text fields bounded so no single item can balloon past the caps. */
const MAX_CONTENT_CHARS = 2000;
const MAX_LABEL_CHARS = 200;

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function itemBytes(item: ProposalItem): number {
  return Buffer.byteLength(JSON.stringify(item), "utf8");
}

/** One human-readable clause per finding (joined into the item's paragraph). */
function findingClause(f: DriftFinding): string {
  switch (f.kind) {
    case "phantom_column":
      return f.closest_actual === null
        ? "documented in dbt YAML but missing from the warehouse catalog (phantom column)"
        : `documented in dbt YAML but missing from the warehouse catalog (phantom column); the closest warehouse column is "${f.closest_actual}" — a possible rename`;
    case "model_never_built":
      return "documented in dbt YAML, but the warehouse catalog has no relation for it (never built, or dropped)";
    case "type_family_mismatch":
      return `declared as ${f.declared_type} (${f.declared_family}) while the warehouse reports ${f.actual_type} (${f.actual_family}) — a type family mismatch`;
    case "hollow_description":
      // Never staged in v0; kept for exhaustiveness.
      return KIND_TAGLINES.hollow_description;
  }
}

function countsByKind(report: DriftReport): Record<FindingKind, number> {
  const counts = Object.fromEntries(
    FINDING_KIND_SEVERITY_ORDER.map((kind) => [kind, 0]),
  ) as Record<FindingKind, number>;
  for (const f of report.findings) counts[f.kind]++;
  return counts;
}

/** Wrap one payload in the propose_batch item envelope — the ONE place the
 * wire envelope (body marker fields, provenance) is spelled out. */
function makeItem(
  type: ProposalItem["type"],
  name: string,
  content: string,
  dbtCheck: SaveFindingBody | SaveSummaryBody,
  rationale: string,
): ProposalItem {
  return {
    type,
    name,
    content,
    body: { source_kind: "dbt", source_tool: SAVE_SOURCE_TOOL, dbt_check: dbtCheck },
    provenance: SAVE_PROVENANCE,
    rationale,
  };
}

/** One proposal for one finding-bearing object (a column, or a whole model). */
function objectItem(
  findings: DriftFinding[],
  report: DriftReport,
  cliVersion: string,
  rationale: string,
): ProposalItem {
  const f0 = findings[0];
  const name = findingTarget(f0);
  const kinds = FINDING_KIND_SEVERITY_ORDER.filter((kind) =>
    findings.some((f) => f.kind === kind),
  );
  const closest = findings.find(
    (f): f is Extract<DriftFinding, { kind: "phantom_column" }> =>
      f.kind === "phantom_column" && f.closest_actual !== null,
  )?.closest_actual;

  const clauses = findings.map(findingClause).join(". Also ");
  const where = f0.yaml_path === null ? "" : ` Declared in ${f0.yaml_path}.`;
  const content = clip(
    `dbt docs drift on ${name} (relation ${f0.schema}.${f0.alias}, dbt project ${projectLabel(report)}): ${clauses}.${where}`,
    MAX_CONTENT_CHARS,
  );

  return makeItem(
    "schema_note",
    name,
    content,
    {
      cli_version: cliVersion,
      finding_kinds: kinds,
      model_unique_id: f0.model_unique_id,
      package_name: f0.package_name,
      database: f0.database,
      schema: f0.schema,
      alias: f0.alias,
      model: f0.model,
      column: f0.column,
      yaml_path: f0.yaml_path,
      manifest_schema_version: report.manifest_schema_version,
      ...(closest !== undefined && closest !== null ? { closest_match: closest } : {}),
    },
    rationale,
  );
}

/** The one run-summary note (always sent — even for a clean report). */
function summaryItem(
  report: DriftReport,
  objectsStaged: number,
  objectsTotal: number,
  cliVersion: string,
  date: string,
  rationale: string,
): ProposalItem {
  const label = clip(projectLabel(report), MAX_LABEL_CHARS);
  const counts = headline(report);
  const content = clip(
    `clarilayer dbt-check ran on ${date} against dbt project ${label}. ${counts}${report.findings.length > 0 ? "." : ""} ` +
      `Staged ${objectsStaged} of ${objectsTotal} drift ${plural(objectsTotal, "object")} for review; ` +
      `hollow descriptions and coverage stats are never staged.`,
    MAX_CONTENT_CHARS,
  );
  return makeItem(
    "note",
    `dbt drift report — ${label}`,
    content,
    {
      cli_version: cliVersion,
      project_name: report.project_name,
      manifest_schema_version: report.manifest_schema_version,
      finding_counts: countsByKind(report),
      objects_staged: objectsStaged,
      objects_total: objectsTotal,
    },
    rationale,
  );
}

/**
 * Map a drift report to propose_batch items: one proposal per finding-bearing
 * object plus one run summary, hard-capped at MAX_SAVE_FINDING_OBJECTS + 1.
 *
 * Selection: report findings are already sorted by severity
 * (FINDING_KIND_SEVERITY_ORDER) then display_name then column; objects rank
 * by their first (most severe) finding's position. `hollow_description`
 * findings and coverage stats are never staged in v0.
 *
 * Size safety runs HERE, before any network: items over the per-item byte cap
 * are excluded, then trailing finding items are shed until the total fits.
 * The run-summary note always survives, so the call always carries >= 1 item.
 */
export function buildSaveItems(report: DriftReport, options: BuildSaveItemsOptions): SaveItemsBuild {
  const requested = options.saveTop ?? DEFAULT_SAVE_TOP;
  // The CLI validates --save-top before calling; this clamp keeps the pure
  // function safe on its own (NaN or out-of-range falls back / clamps).
  const cap = Number.isInteger(requested)
    ? Math.min(Math.max(requested, 1), MAX_SAVE_FINDING_OBJECTS)
    : DEFAULT_SAVE_TOP;

  // Group stageable findings per object, preserving the report's canonical
  // severity-first order (first appearance ranks the object).
  const byObject = new Map<string, DriftFinding[]>();
  for (const f of report.findings) {
    if (f.kind === "hollow_description") continue;
    const key = `${f.model_unique_id} ${f.column ?? ""}`;
    const group = byObject.get(key);
    if (group === undefined) byObject.set(key, [f]);
    else group.push(f);
  }
  const objects = [...byObject.values()];
  const objectsTotal = objects.length;

  const date = options.now.toISOString().slice(0, 10);
  const rationale = `Found by clarilayer dbt-check ${options.cliVersion} on ${date}`;

  const skippedLocally: SaveItemsBuild["skippedLocally"] = [];
  const kept: ProposalItem[] = [];
  for (const group of objects.slice(0, cap)) {
    const item = objectItem(group, report, options.cliVersion, rationale);
    if (itemBytes(item) > MAX_ITEM_BYTES) {
      skippedLocally.push({ name: item.name, reason: "local_item_cap" });
    } else {
      kept.push(item);
    }
  }

  // Total-size fit: shed from the tail (least severe stays out) until the
  // finding items plus the summary — whose text mentions the final count, so
  // it is rebuilt each pass — fit the per-call byte budget.
  for (;;) {
    const summary = summaryItem(report, kept.length, objectsTotal, options.cliVersion, date, rationale);
    const total = kept.reduce((sum, item) => sum + itemBytes(item), 0) + itemBytes(summary);
    if (total <= MAX_TOTAL_ITEM_BYTES || kept.length === 0) {
      return {
        items: [...kept, summary],
        objectsTotal,
        objectsStaged: kept.length,
        skippedLocally,
      };
    }
    const shed = kept.pop() as ProposalItem;
    skippedLocally.push({ name: shed.name, reason: "local_total_cap" });
  }
}

/** The exact JSON-RPC POST body for one propose_batch call. */
export function buildProposeBatchRequest(items: ProposalItem[]): ProposeBatchRequestBody {
  return {
    jsonrpc: "2.0",
    id: JSONRPC_REQUEST_ID,
    method: "tools/call",
    params: { name: PROPOSE_BATCH_TOOL, arguments: { items } },
  };
}

// ---------------------------------------------------------------------------
// Server result shapes (normalized defensively; the server is the authority)
// ---------------------------------------------------------------------------

export interface ProposeBatchItemResult {
  index: number;
  /** "proposed" | "duplicate" | "dropped" (unknown values pass through). */
  status: string;
  type: string;
  name: string;
  id?: string;
  /** Stable drop reasons include too_large, batch_too_large, backlog_full, duplicate_in_payload. */
  reason?: string;
  detail?: string;
}

export interface ProposeBatchSummary {
  received: number;
  proposed: number;
  duplicate: number;
  dropped: number;
}

export interface ProposeBatchResult {
  ok: boolean;
  results: ProposeBatchItemResult[];
  summary: ProposeBatchSummary;
  pending_count: number | null;
  console_url: string | null;
}

export type ProposeBatchOutcome =
  | { ok: true; result: ProposeBatchResult }
  | { ok: false; message: string };

export interface SendProposeBatchOptions {
  /** Endpoint override — a test seam; production always uses MCP_URL. */
  url?: string;
  /** fetch override — a test seam; production uses the built-in fetch. */
  fetchImpl?: typeof fetch;
  /** Timeout override; defaults to DEFAULT_SAVE_TIMEOUT_MS. */
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Pull the JSON-RPC response out of an SSE body: the first `data:` payload
 * that parses to an object carrying `jsonrpc`.
 */
function parseSseJsonRpc(text: string): unknown {
  for (const event of text.replace(/\r\n/g, "\n").split("\n\n")) {
    const data = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .join("\n");
    if (data === "") continue;
    const parsed = tryParseJson(data);
    if (isRecord(parsed) && "jsonrpc" in parsed) return parsed;
  }
  return undefined;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeResult(raw: Record<string, unknown>): ProposeBatchResult {
  const rawSummary = isRecord(raw.summary) ? raw.summary : {};
  const results: ProposeBatchItemResult[] = (Array.isArray(raw.results) ? raw.results : [])
    .filter(isRecord)
    .map((r) => ({
      index: asNumber(r.index) ?? -1,
      status: typeof r.status === "string" ? r.status : "",
      type: typeof r.type === "string" ? r.type : "",
      name: typeof r.name === "string" ? r.name : "",
      ...(typeof r.id === "string" ? { id: r.id } : {}),
      ...(typeof r.reason === "string" ? { reason: r.reason } : {}),
      ...(typeof r.detail === "string" ? { detail: r.detail } : {}),
    }));
  return {
    ok: raw.ok === true,
    results,
    summary: {
      received: asNumber(rawSummary.received) ?? 0,
      proposed: asNumber(rawSummary.proposed) ?? 0,
      duplicate: asNumber(rawSummary.duplicate) ?? 0,
      dropped: asNumber(rawSummary.dropped) ?? 0,
    },
    pending_count: asNumber(raw.pending_count),
    console_url: typeof raw.console_url === "string" ? raw.console_url : null,
  };
}

/**
 * POST the one propose_batch JSON-RPC request. Terminal on every failure —
 * no retries, no backoff — and never throws: the outcome carries either the
 * parsed structuredContent or an actionable message for stderr.
 */
export async function sendProposeBatch(
  key: string,
  request: ProposeBatchRequestBody,
  options: SendProposeBatchOptions = {},
): Promise<ProposeBatchOutcome> {
  const url = options.url ?? MCP_URL;
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_SAVE_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let status: number;
  let statusOk: boolean;
  let contentType: string;
  let retryAfter: string | null;
  let text: string;
  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        // All three headers are required — the server 406s without the dual Accept.
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    status = res.status;
    statusOk = res.ok;
    contentType = res.headers.get("content-type") ?? "";
    retryAfter = res.headers.get("retry-after");
    text = await res.text();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: controller.signal.aborted
        ? `Staging timed out after ${timeoutMs / 1000}s reaching ${url}. Nothing was staged; the local report is unaffected.`
        : `Could not reach ${url}: ${detail}. Nothing was staged; the local report is unaffected.`,
    };
  } finally {
    clearTimeout(timer);
  }

  if (status === 401) {
    const body = tryParseJson(text);
    const errorCode = isRecord(body) && typeof body.error === "string" ? ` (${body.error})` : "";
    // Surface the server's own fix instructions verbatim when it sent them.
    const howToFix =
      isRecord(body) && typeof body.how_to_fix === "string"
        ? body.how_to_fix
        : `Mint a free context key at ${CONNECT_URL}, then pass it with --key cl_… or set CLARILAYER_CONTEXT_KEY.`;
    return { ok: false, message: `ClariLayer rejected the context key — HTTP 401${errorCode}.\n${howToFix}` };
  }
  if (status === 413) {
    return {
      ok: false,
      message: `The staged payload was too large for the server (HTTP 413). Nothing was staged — try a smaller --save-top.`,
    };
  }
  if (status === 429) {
    const seconds = retryAfter?.trim();
    const when = seconds !== undefined && /^\d+$/.test(seconds) ? `in ${seconds} seconds` : "shortly";
    return {
      ok: false,
      message: `Rate limited by the server (HTTP 429). Nothing was staged — try again ${when}.`,
    };
  }
  if (!statusOk) {
    return { ok: false, message: `Staging failed: HTTP ${status} from ${url}. Nothing was staged.` };
  }

  const rpc = contentType.includes("text/event-stream") ? parseSseJsonRpc(text) : tryParseJson(text);
  if (!isRecord(rpc)) {
    return { ok: false, message: `Unexpected response from ${url} (HTTP ${status}): not a JSON-RPC message.` };
  }
  if (rpc.error !== undefined) {
    const e = isRecord(rpc.error) ? rpc.error : {};
    const parts = [typeof e.message === "string" ? e.message : "unknown error"];
    if (e.data !== undefined) parts.push(JSON.stringify(e.data));
    return { ok: false, message: `The ClariLayer server returned an error: ${parts.join(" — ")}` };
  }
  const structured = isRecord(rpc.result) ? rpc.result.structuredContent : undefined;
  if (!isRecord(structured)) {
    return { ok: false, message: `Unexpected response from ${url}: no structured propose_batch result.` };
  }
  return { ok: true, result: normalizeResult(structured) };
}

// ---------------------------------------------------------------------------
// Result rendering (pure, so the copy is testable)
// ---------------------------------------------------------------------------

/**
 * Human status lines for a completed propose_batch call: per-status counts,
 * every dropped item's reason, local size-cap exclusions, then the Inbox
 * link from the response (never hardcoded; omitted when the server sent
 * none) and the always-on connect pointer.
 *
 * Language rule (binding): staged items are "staged for your review — they
 * land as asserted entries if you accept them". Nothing here may claim a
 * stronger trust status.
 */
export function renderSaveResultLines(
  result: ProposeBatchResult,
  skippedLocally: SaveItemsBuild["skippedLocally"] = [],
): string[] {
  const s = result.summary;
  const lines: string[] = [
    `Staged ${s.proposed} of ${s.received} ${plural(s.received, "proposal")} for your review — they land as asserted entries if you accept them.`,
  ];
  if (s.duplicate > 0) {
    lines.push(`  ${s.duplicate} already pending in your Inbox (duplicate).`);
  }
  for (const r of result.results) {
    if (r.status === "dropped") {
      lines.push(`  not staged: ${r.name} — ${r.reason ?? "dropped"}${r.detail !== undefined ? ` (${r.detail})` : ""}`);
    }
  }
  for (const skip of skippedLocally) {
    lines.push(`  not sent (local size cap): ${skip.name}`);
  }
  if (result.pending_count !== null) {
    lines.push(`Pending in your Inbox: ${result.pending_count}.`);
  }
  if (result.console_url !== null) {
    lines.push(`Review in your Inbox: ${result.console_url}`);
  }
  lines.push(`For the always-on context layer in your agent: ${CONNECT_URL}`);
  return lines;
}
