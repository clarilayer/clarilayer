/**
 * Copy shared by both drift-report renderers (terminal + markdown), so the
 * two surfaces can never disagree on what a finding kind is called, how the
 * headline counts read, or what the not-checked disclosure says.
 *
 * Language rules (binding for every renderer):
 * - drift facts are "drift findings";
 * - a run that found nothing says so as "no drift found across N checked
 *   models", never as a stronger claim — this tool compares two files dbt
 *   already wrote, and its output must not promise more than that;
 * - every report names what it did NOT check (see {@link notCheckedLine}).
 */
import {
  FINDING_KIND_SEVERITY_ORDER,
  type DriftFinding,
  type DriftReport,
  type FindingKind,
} from "./types.js";

/** Section titles, shared verbatim by the terminal and markdown reports. */
export const KIND_TITLES: Record<FindingKind, string> = {
  phantom_column: "Phantom columns",
  model_never_built: "Models never built",
  type_family_mismatch: "Type family mismatches",
  hollow_description: "Hollow descriptions",
};

/** One-line explanation per kind, appended to section headings. */
export const KIND_TAGLINES: Record<FindingKind, string> = {
  phantom_column: "documented in YAML, missing from the warehouse",
  model_never_built: "documented, but no relation in the warehouse",
  type_family_mismatch: "declared type family differs from the warehouse",
  hollow_description: "declared, but the description is empty",
};

/** Count-noun forms for the headline breakdown ("3 phantom columns"). */
const KIND_COUNT_NOUNS: Record<FindingKind, readonly [singular: string, plural: string]> = {
  phantom_column: ["phantom column", "phantom columns"],
  model_never_built: ["model never built", "models never built"],
  type_family_mismatch: ["type family mismatch", "type family mismatches"],
  hollow_description: ["hollow description", "hollow descriptions"],
};

/** "model" / "models" — pass an explicit plural for irregular forms. */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return n === 1 ? singular : pluralForm;
}

/**
 * Findings grouped per kind, in severity order — one pass over the report.
 * Only kinds with at least one finding are returned, and within a kind the
 * report's canonical display_name/column sort is preserved.
 */
export function findingsByKind(
  report: DriftReport,
): Array<{ kind: FindingKind; findings: DriftFinding[] }> {
  const byKind = {} as Record<FindingKind, DriftFinding[]>;
  for (const kind of FINDING_KIND_SEVERITY_ORDER) byKind[kind] = [];
  for (const f of report.findings) byKind[f.kind].push(f);
  return FINDING_KIND_SEVERITY_ORDER.filter((kind) => byKind[kind].length > 0).map((kind) => ({
    kind,
    findings: byKind[kind],
  }));
}

/**
 * Opening line of every report. With findings: the total plus per-kind
 * counts in severity order. Clean: the exact no-drift phrasing, where the
 * checked models are the built ones (what "checked" honestly excludes is the
 * {@link notCheckedLine}'s job to say). A renderer that already grouped the
 * findings passes its grouping in rather than grouping again.
 */
export function headline(
  report: DriftReport,
  groups: Array<{ kind: FindingKind; findings: DriftFinding[] }> = findingsByKind(report),
): string {
  const total = report.findings.length;
  if (total === 0) {
    const built = report.coverage.models.built;
    return `No drift found across ${built} checked ${plural(built, "model")}.`;
  }
  const parts = groups.map(
    ({ kind, findings }) => `${findings.length} ${plural(findings.length, ...KIND_COUNT_NOUNS[kind])}`,
  );
  return `${total} drift ${plural(total, "finding")}: ${parts.join(", ")}`;
}

/** The honesty line: what this run did NOT check, from the coverage stats. */
export function notCheckedLine(report: DriftReport): string {
  const { models, columns } = report.coverage;
  const undocumentedModels = models.built - models.documented;
  return (
    `Not checked: ${undocumentedModels} built ${plural(undocumentedModels, "model")} with no declared docs` +
    ` and ${columns.undocumented} warehouse ${plural(columns.undocumented, "column")} with no YAML declaration.`
  );
}

/** "display_name.column" for column findings; bare display_name at model level. */
export function findingTarget(f: DriftFinding): string {
  return f.column === null ? f.display_name : `${f.display_name}.${f.column}`;
}

/** Report title target: the project name, or a placeholder when unnamed. */
export function projectLabel(report: DriftReport): string {
  return report.project_name || "(unnamed dbt project)";
}

/** The rename-candidate hint for a phantom column ("did you mean X?"). */
export function renameHint(name: string): string {
  return `did you mean ${name}?`;
}

/** Artifact generated_at for display; dbt may omit it. */
export function formatGeneratedAt(value: string | null): string {
  return value ?? "unknown";
}
