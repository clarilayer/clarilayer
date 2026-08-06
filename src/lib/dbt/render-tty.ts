/**
 * Terminal drift report: DriftReport + options in, plain-text string out.
 *
 * Pure — no I/O, no TTY detection, no color or emoji — so the output is
 * copy-pasteable byte-for-byte into an issue or a PR comment.
 *
 * Shape (binding — tests assert the order):
 *   header (project + artifact schema versions and timestamps)
 *   headline (counts, or the clean-run phrasing)
 *   one section per finding kind in severity order, each capped at `top`
 *     entries with an "…and N more (see --md)" overflow line
 *   the not-checked disclosure
 *   ONE coverage line, always LAST.
 */
import type { DriftFinding, DriftReport } from "./types.js";
import {
  KIND_TAGLINES,
  KIND_TITLES,
  findingTarget,
  findingsByKind,
  formatGeneratedAt,
  headline,
  notCheckedLine,
  plural,
} from "./render-shared.js";

/** Default per-section display cap (the CLI's --top). */
export const DEFAULT_TOP_PER_SECTION = 10;

export interface TtyRenderOptions {
  /**
   * Max findings listed per section; the rest collapse into an overflow
   * line. The CLI validates its flag before calling; anything that is not a
   * non-negative integer falls back to {@link DEFAULT_TOP_PER_SECTION} here,
   * so a pure render can never NaN-slice its way into silence.
   */
  top: number;
}

function findingLine(f: DriftFinding): string {
  switch (f.kind) {
    case "phantom_column":
      return f.closest_actual === null
        ? `  ${findingTarget(f)}`
        : `  ${findingTarget(f)}  → did you mean ${f.closest_actual}?`;
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
  const top =
    Number.isInteger(options.top) && options.top >= 0 ? options.top : DEFAULT_TOP_PER_SECTION;

  const lines: string[] = [];
  lines.push(`dbt-check — docs drift for ${report.project_name || "(unnamed dbt project)"}`);
  lines.push(
    `manifest v${report.manifest_schema_version} (generated ${formatGeneratedAt(report.manifest_generated_at)})` +
      ` vs catalog v${report.catalog_schema_version} (generated ${formatGeneratedAt(report.catalog_generated_at)})`,
  );
  lines.push("");
  lines.push(headline(report));

  for (const { kind, findings } of findingsByKind(report)) {
    if (findings.length === 0) continue;
    lines.push("");
    lines.push(`${KIND_TITLES[kind]} (${findings.length}) — ${KIND_TAGLINES[kind]}`);
    for (const f of findings.slice(0, top)) lines.push(findingLine(f));
    const hidden = findings.length - Math.min(findings.length, top);
    if (hidden > 0) lines.push(`  …and ${hidden} more (see --md)`);
  }

  lines.push("");
  lines.push(notCheckedLine(report));
  lines.push(coverageLine(report));
  return `${lines.join("\n")}\n`;
}
