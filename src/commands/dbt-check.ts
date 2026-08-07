/**
 * `clarilayer dbt-check` — docs-vs-warehouse drift for a dbt project.
 *
 * Thin command shell around the pure pieces: resolve where the artifacts
 * live → loadDbtArtifacts (all refusal gates) → analyzeDrift (pure engine)
 * → render (terminal, JSON, and/or markdown). Local and read-only by
 * default: without `--save`, no network, nothing uploaded. With `--save`,
 * exactly one propose_batch call stages selected findings to the user's
 * ClariLayer Context Inbox for review (src/lib/save.ts).
 *
 * Stream contract (binding): stdout carries the report and nothing else —
 * the terminal rendering by default, exactly the JSON document with `json` —
 * so `clarilayer dbt-check --json | jq .` always works. Every status and
 * error line goes to stderr. Two --save amendments: save status lines join
 * stdout in the terminal rendering but go to stderr under --json (the JSON
 * document stays the only stdout content), and `--save --dry-run` REPLACES
 * the stdout report with the exact would-be JSON-RPC POST body.
 *
 * Exit codes: 0 = the check ran (findings or not; a partially-accepted save
 * still counts as ran); 2 = usage, artifact, or staging problem, with an
 * actionable message on stderr. Nothing else.
 */
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CONNECT_URL, MCP_URL, keyLooksValid } from "../lib/constants.js";
import { analyzeDrift } from "../lib/dbt/engine.js";
import { DEFAULT_MAX_ARTIFACT_BYTES, loadDbtArtifacts } from "../lib/dbt/load.js";
import { renderMarkdownReport } from "../lib/dbt/render-md.js";
import { DEFAULT_TOP_PER_SECTION, isValidTop, renderTtyReport } from "../lib/dbt/render-tty.js";
import { artifactSkewLines, headline, plural } from "../lib/dbt/render-shared.js";
import {
  MAX_SAVE_FINDING_OBJECTS,
  buildProposeBatchRequest,
  buildSaveItems,
  isValidSaveTop,
  keyRedactor,
  renderSaveResultLines,
  sendProposeBatch,
  type SaveItemsBuild,
  type SendProposeBatchOptions,
} from "../lib/save.js";
import type { DriftReport } from "../lib/dbt/types.js";

export interface DbtCheckOptions {
  /** dbt project directory (default: the current working directory). */
  projectDir?: string;
  /** Artifacts directory (default: `<projectDir>/target`). */
  targetPath?: string;
  /** When set, also write the full markdown report to this file. */
  md?: string;
  /** Terminal display cap per finding section (default: DEFAULT_TOP_PER_SECTION). */
  top?: number;
  /** Print the report as JSON on stdout instead of the terminal rendering. */
  json?: boolean;
  /** Per-artifact size cap in MB (default: DEFAULT_MAX_ARTIFACT_BYTES). */
  maxArtifactMb?: number;
  /** Stage top findings to the user's ClariLayer Context Inbox for review. */
  save?: boolean;
  /** Finding objects staged with --save (default: DEFAULT_SAVE_TOP, max 24). */
  saveTop?: number;
  /** Context key for --save (falls back to CLARILAYER_CONTEXT_KEY). */
  key?: string;
  /** With --save: print the exact would-be request body; send nothing. */
  dryRun?: boolean;
  /** CLI version, stamped into --save payloads (the report carries none). */
  version?: string;
  /**
   * Test seam only: transport overrides (url/fetch/timeout) forwarded to
   * sendProposeBatch so the in-process tests can pin the failure paths with
   * an injected fetch. Never set by the CLI parser; production always runs
   * with the defaults.
   */
  saveTransport?: SendProposeBatchOptions;
}

const MB = 1024 * 1024;

function fail(message: string): number {
  process.stderr.write(`${message}\n`);
  return 2;
}

/**
 * Run the check and return the process exit code (0 ran, 2 refused). All
 * failures are reported on stderr here — this function never throws for
 * expected problems (bad option values, missing/oversized/malformed
 * artifacts, an unwritable --md path, a failed --save call).
 */
export async function runDbtCheck(options: DbtCheckOptions = {}): Promise<number> {
  // Option bounds up front — Number.isInteger/isFinite FIRST, then the
  // bounds, so NaN can never slide through a bare comparison (a NaN cap
  // would silently disable the size guard rather than fail it).
  const top = options.top ?? DEFAULT_TOP_PER_SECTION;
  if (!isValidTop(top)) {
    return fail(
      `--top must be a whole number >= 0 (findings shown per section); got ${String(options.top)}.`,
    );
  }
  let maxBytes = DEFAULT_MAX_ARTIFACT_BYTES;
  if (options.maxArtifactMb !== undefined) {
    const mb = options.maxArtifactMb;
    if (!Number.isFinite(mb) || mb <= 0 || mb * MB > Number.MAX_SAFE_INTEGER) {
      return fail(`--max-artifact-mb must be a positive number of megabytes; got ${String(mb)}.`);
    }
    maxBytes = Math.floor(mb * MB);
  }
  const saving = options.save === true;
  const dryRun = options.dryRun === true;
  if (options.saveTop !== undefined && !isValidSaveTop(options.saveTop)) {
    return fail(
      `--save-top must be a whole number between 1 and ${MAX_SAVE_FINDING_OBJECTS} (drift objects staged); got ${String(options.saveTop)}.`,
    );
  }

  // Key pre-flight, before any work: a lenient shape check only — the server
  // stays the authority. A dry run sends nothing and never reads the key, so
  // the payload can be previewed before a key exists.
  let contextKey = "";
  if (saving && !dryRun) {
    const raw = (options.key ?? process.env.CLARILAYER_CONTEXT_KEY ?? "").trim();
    if (!keyLooksValid(raw)) {
      const what =
        raw === ""
          ? "no context key was provided"
          : 'the provided context key does not look like one (expected "cl_…")';
      return fail(
        `--save stages findings to your ClariLayer Context Inbox, but ${what}.\n` +
          `Mint a free key at ${CONNECT_URL}, then pass it with --key cl_… or set CLARILAYER_CONTEXT_KEY.\n` +
          `Nothing was sent.`,
      );
    }
    contextKey = raw;
  }

  const projectDir = resolve(options.projectDir ?? process.cwd());
  const targetPath =
    options.targetPath !== undefined ? resolve(options.targetPath) : join(projectDir, "target");

  let report: DriftReport;
  try {
    const { manifest, catalog } = loadDbtArtifacts(targetPath, { maxBytes });
    report = analyzeDrift(manifest, catalog);
  } catch (err) {
    // DbtLoadError messages are already actionable, and analyzeDrift's
    // schema-version refusal shares the loader's exact wording.
    return fail(err instanceof Error ? err.message : String(err));
  }

  if (options.md !== undefined) {
    const mdPath = resolve(options.md);
    try {
      writeFileSync(mdPath, renderMarkdownReport(report));
    } catch (err) {
      return fail(
        `Could not write the markdown report to ${mdPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    process.stderr.write(`Markdown report written to ${mdPath}\n`);
  }

  // The ONE options → payload mapping, shared by the dry-run and live-save
  // branches (they are mutually exclusive) so the previewed body can never
  // drift from the body actually sent. Built up front when saving: the
  // builder throws only when even the truncated run summary cannot fit the
  // payload caps, and that refusal is an expected problem (exit 2), not a
  // crash.
  let saveBuild: SaveItemsBuild | undefined;
  if (saving) {
    try {
      saveBuild = buildSaveItems(report, {
        cliVersion: options.version ?? "0.0.0",
        now: new Date(),
        ...(options.saveTop !== undefined ? { saveTop: options.saveTop } : {}),
      });
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  // --save --dry-run: stdout carries exactly the would-be JSON-RPC POST body
  // (replacing the normal report, --json included); status goes to stderr;
  // nothing is sent.
  if (saving && dryRun && saveBuild !== undefined) {
    const build = saveBuild;
    const request = buildProposeBatchRequest(build.items);
    process.stdout.write(`${JSON.stringify(request, null, 2)}\n`);
    for (const skip of build.skippedLocally) {
      process.stderr.write(`not sent (local size cap): ${skip.name}\n`);
    }
    process.stderr.write(
      `Dry run: this JSON-RPC body (${build.items.length} ${plural(build.items.length, "item")}: ` +
        `${build.objectsStaged} of ${build.objectsTotal} drift ${plural(build.objectsTotal, "object")} + 1 run summary) ` +
        `would be POSTed to ${MCP_URL}; nothing was sent.\n`,
    );
    return 0;
  }

  if (options.json === true) {
    // stdout stays exactly the JSON document, where the skew is already a
    // structured field (report.artifact_skew) — the human warning is status,
    // so it goes to stderr like every other status line, ahead of the
    // headline it qualifies.
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    for (const line of artifactSkewLines(report) ?? []) process.stderr.write(`${line}\n`);
    process.stderr.write(`${headline(report)}\n`);
  } else {
    // The closing next step is for a human who just saw drift and has not
    // acted on it: findings exist, and this run did not already save them.
    // (--json never reaches this branch.)
    const saveHint = report.findings.length > 0 && !saving;
    process.stdout.write(renderTtyReport(report, { top, saveHint }));
  }

  if (saving && saveBuild !== undefined) {
    // Save status is report-adjacent output: stdout in the terminal
    // rendering, stderr under --json (stdout stays exactly the JSON
    // document). Failures always land on stderr with exit 2.
    const emit =
      options.json === true
        ? (line: string) => process.stderr.write(`${line}\n`)
        : (line: string) => process.stdout.write(`${line}\n`);
    const build = saveBuild;
    const outcome = await sendProposeBatch(
      contextKey,
      buildProposeBatchRequest(build.items),
      options.saveTransport,
    );
    if (!outcome.ok) return fail(outcome.message);
    if (options.json !== true) emit("");
    // Success responses still carry server-derived strings — scrub the key
    // from them just like the failure messages (SEC: never print the bearer).
    const lines = renderSaveResultLines(outcome.result, keyRedactor(contextKey), build.skippedLocally);
    for (const line of lines) emit(line);
  }
  return 0;
}
