/**
 * `clarilayer dbt-check` — docs-vs-warehouse drift for a dbt project.
 *
 * Thin command shell around the pure pieces: resolve where the artifacts
 * live → loadDbtArtifacts (all refusal gates) → analyzeDrift (pure engine)
 * → render (terminal, JSON, and/or markdown). Local and read-only: no
 * network, nothing uploaded.
 *
 * Stream contract (binding): stdout carries the report and nothing else —
 * the terminal rendering by default, exactly the JSON document with `json` —
 * so `clarilayer dbt-check --json | jq .` always works. Every status and
 * error line goes to stderr.
 *
 * Exit codes: 0 = the check ran (findings or not); 2 = usage or artifact
 * problem, with an actionable message on stderr. Nothing else.
 */
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { analyzeDrift } from "../lib/dbt/engine.js";
import { DEFAULT_MAX_ARTIFACT_BYTES, loadDbtArtifacts } from "../lib/dbt/load.js";
import { renderMarkdownReport } from "../lib/dbt/render-md.js";
import { DEFAULT_TOP_PER_SECTION, renderTtyReport } from "../lib/dbt/render-tty.js";
import { headline } from "../lib/dbt/render-shared.js";
import type { DriftReport } from "../lib/dbt/types.js";

export interface DbtCheckOptions {
  /** dbt project directory (default: the current working directory). */
  projectDir?: string;
  /** Artifacts directory (default: `<projectDir>/target`). */
  targetPath?: string;
  /** When set, also write the full markdown report to this file. */
  md?: string;
  /** Terminal display cap per finding section (default: 10). */
  top?: number;
  /** Print the report as JSON on stdout instead of the terminal rendering. */
  json?: boolean;
  /** Per-artifact size cap in MB (default: DEFAULT_MAX_ARTIFACT_BYTES). */
  maxArtifactMb?: number;
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
 * artifacts, an unwritable --md path).
 */
export function runDbtCheck(options: DbtCheckOptions = {}): number {
  // Option bounds up front — Number.isInteger/isFinite FIRST, then the
  // bounds, so NaN can never slide through a bare comparison (a NaN cap
  // would silently disable the size guard rather than fail it).
  const top = options.top ?? DEFAULT_TOP_PER_SECTION;
  if (!Number.isInteger(top) || top < 0) {
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

  if (options.json === true) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.stderr.write(`${headline(report)}\n`);
  } else {
    process.stdout.write(renderTtyReport(report, { top }));
  }
  return 0;
}
