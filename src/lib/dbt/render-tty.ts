/**
 * Terminal drift report: DriftReport + options in, plain-text string out.
 *
 * Pure — no I/O, no TTY detection, no color or emoji — so the output is
 * copy-pasteable byte-for-byte into an issue or a PR comment.
 *
 * Shape (binding — tests assert the order):
 *   header (project + artifact schema versions and timestamps)
 *   the artifact-skew warning, when the two artifacts are too far apart in
 *     time — above everything it qualifies, which is everything below it
 *   headline (counts, or the clean-run phrasing)
 *   one section per finding kind in severity order, each capped at `top`
 *     entries with an "…and N more (see --md)" overflow line
 *   the not-checked disclosure
 *   ONE coverage line, always last in the report proper
 *   the save-preview next step, ONLY when the caller asks for it (see
 *     {@link TtyRenderOptions.saveHint}).
 */
import type { DriftFinding, DriftReport } from "./types.js";
import {
  KIND_TAGLINES,
  KIND_TITLES,
  artifactSkewLines,
  findingTarget,
  findingsByKind,
  formatGeneratedAt,
  headline,
  notCheckedLine,
  plural,
  projectLabel,
  renameHint,
  savePreviewCtaLines,
} from "./render-shared.js";

/** Default per-section display cap (the CLI's --top). */
export const DEFAULT_TOP_PER_SECTION = 10;

/**
 * A usable per-section cap: a non-negative integer. The single definition of
 * `--top` validity — the CLI refuses values that fail it, and
 * {@link renderTtyReport} falls back to the default on them.
 */
export function isValidTop(top: number): boolean {
  return Number.isInteger(top) && top >= 0;
}

export interface TtyRenderOptions {
  /**
   * Max findings listed per section; the rest collapse into an overflow
   * line. The CLI validates its flag before calling; anything that is not a
   * non-negative integer falls back to {@link DEFAULT_TOP_PER_SECTION} here,
   * so a pure render can never NaN-slice its way into silence.
   */
  top: number;
  /**
   * Append the save-preview next step after the coverage line. Defaults to
   * off, so this rendering stays the plain report unless the CLI asks. The
   * CLI owns the condition (findings exist, no --save, no --json), because
   * the renderer cannot see the flags.
   */
  saveHint?: boolean;
}

function findingLine(f: DriftFinding): string {
  switch (f.kind) {
    case "phantom_column":
      return f.closest_actual === null
        ? `  ${findingTarget(f)}`
        : `  ${findingTarget(f)}  → ${renameHint(f.closest_actual)}`;
    case "model_never_built":
      return f.yaml_path === null ? `  ${f.display_name}` : `  ${f.display_name}  (${f.yaml_path})`;
    case "type_family_mismatch":
      return `  ${findingTarget(f)}  declared ${f.declared_type} (${f.declared_family}) vs warehouse ${f.actual_type} (${f.actual_family})`;
    case "hollow_description":
      return `  ${findingTarget(f)}`;
  }
}

function coverageLine(report: DriftReport): string {
  const { models, columns, hollow } = report.coverage;
  return (
    `Coverage: ${models.total} ${plural(models.total, "model")} (${models.built} built, ` +
    `${models.ephemeral} ephemeral, ${models.documented} documented), ` +
    `${columns.actual} warehouse ${plural(columns.actual, "column")}, ${columns.declared} declared, ` +
    `${columns.undocumented} undocumented, ${hollow} hollow.`
  );
}

export function renderTtyReport(report: DriftReport, options: TtyRenderOptions): string {
  const top = isValidTop(options.top) ? options.top : DEFAULT_TOP_PER_SECTION;

  const lines: string[] = [];
  lines.push(`dbt-check — docs drift for ${projectLabel(report)}`);
  lines.push(
    `manifest v${report.manifest_schema_version} (generated ${formatGeneratedAt(report.manifest_generated_at)})` +
      ` vs catalog v${report.catalog_schema_version} (generated ${formatGeneratedAt(report.catalog_generated_at)})`,
  );
  // Above the headline as well as the findings: when the artifacts are far
  // apart, the counts are as suspect as the rows they summarize.
  const skew = artifactSkewLines(report);
  if (skew !== null) lines.push("", ...skew);
  lines.push("");
  const groups = findingsByKind(report);
  lines.push(headline(report, groups));

  for (const { kind, findings } of groups) {
    lines.push("");
    lines.push(`${KIND_TITLES[kind]} (${findings.length}) — ${KIND_TAGLINES[kind]}`);
    for (const f of findings.slice(0, top)) lines.push(findingLine(f));
    const hidden = findings.length - Math.min(findings.length, top);
    if (hidden > 0) lines.push(`  …and ${hidden} more (see --md)`);
  }

  lines.push("");
  lines.push(notCheckedLine(report));
  lines.push(coverageLine(report));

  if (options.saveHint === true) lines.push("", ...savePreviewCtaLines());
  return `${lines.join("\n")}\n`;
}
