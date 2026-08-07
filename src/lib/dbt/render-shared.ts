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
 * - a finding names what was OBSERVED, never why. A model absent from the
 *   catalog is "missing from the catalog"; "never built" would be one of
 *   several possible causes stated as fact;
 * - every report names what it did NOT check (see {@link notCheckedLine}),
 *   and says when its two inputs are too far apart in time to be compared
 *   with confidence (see {@link artifactSkewLines}).
 *
 * The OBSERVED-never-why rule binds one non-renderer too: save.ts's
 * findingClause, which writes finding prose into the user's context store
 * where it outlives the run and is never re-rendered from here. Adding or
 * renaming a finding kind means editing the three tables below AND that
 * switch.
 */
import {
  FINDING_KIND_SEVERITY_ORDER,
  type DriftFinding,
  type DriftReport,
  type FindingKind,
} from "./types.js";

/**
 * Section titles, shared verbatim by the terminal and markdown reports.
 *
 * `model_never_built` deliberately reads as "Missing from the catalog": the
 * observed fact is absence from catalog.json, and the causes (never built,
 * dropped, built into a different target, artifacts generated at different
 * times) are not distinguishable from the two files. The machine `kind` keeps
 * its 0.2.0 spelling — it is a published contract, this label is not.
 */
export const KIND_TITLES: Record<FindingKind, string> = {
  phantom_column: "Phantom columns",
  model_never_built: "Missing from the catalog",
  type_family_mismatch: "Type family mismatches",
  hollow_description: "Hollow descriptions",
};

/** One-line explanation per kind, appended to section headings. */
export const KIND_TAGLINES: Record<FindingKind, string> = {
  phantom_column: "documented in YAML, missing from the warehouse",
  model_never_built:
    "a non-ephemeral model present in the manifest but absent from the warehouse catalog",
  type_family_mismatch: "declared type family differs from the warehouse",
  hollow_description: "declared, but the description is empty",
};

/** Count-noun forms for the headline breakdown ("3 phantom columns"). */
const KIND_COUNT_NOUNS: Record<FindingKind, readonly [singular: string, plural: string]> = {
  phantom_column: ["phantom column", "phantom columns"],
  model_never_built: ["model missing from the catalog", "models missing from the catalog"],
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

/**
 * A skew as a coarse human duration ("2 hours 5 minutes", "1 day 6 hours").
 * Minutes are only worth printing under a day, and the seconds branch is
 * unreachable from the warning below, which fires only above an hour.
 */
function formatSkewDuration(seconds: number): string {
  const total = Math.abs(Math.round(seconds));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${plural(days, "day")}`);
  if (hours > 0) parts.push(`${hours} ${plural(hours, "hour")}`);
  if (minutes > 0 && days === 0) parts.push(`${minutes} ${plural(minutes, "minute")}`);
  if (parts.length === 0) parts.push(`${total} ${plural(total, "second")}`);
  return parts.join(" ");
}

/**
 * The artifact-freshness warning, or null when there is nothing to warn
 * about — the engine already decided that, via `report.artifact_skew.stale`
 * (ARTIFACT_SKEW_STALE_SECONDS in types.ts is the one threshold); a missing
 * stamp leaves the gap unknown, which is likewise not a warning.
 *
 * Every finding in this report assumes manifest.json and catalog.json describe
 * the same moment. Both directions break that assumption, but NOT in the same
 * way, so they do not share a sentence:
 *
 * - manifest newer (the dangerous one): the catalog predates the docs, so
 *   columns and models that were documented AND built since can surface as
 *   phantom columns or as missing from the catalog — real-looking findings
 *   that are artifacts of the older file. Regenerate before acting.
 * - catalog newer (the milder one): the manifest predates the warehouse, so
 *   docs changes made since were not compared at all and drift can be
 *   UNDER-reported. A clean result here is the claim to distrust.
 *
 * Returned as a (warning, guidance) pair so each renderer can frame the two
 * parts its own way — markdown bolds the warning and indents the guidance
 * under it, the terminal prints both plain. The pair is a tuple rather than a
 * bare string[] precisely so that framing-by-position is checked. Every
 * renderer must place them ABOVE the findings, since they qualify all of them.
 */
export function artifactSkewLines(
  report: DriftReport,
): readonly [warning: string, guidance: string] | null {
  const { skew_seconds: skew, stale } = report.artifact_skew;
  if (!stale || skew === null) return null;
  const gap = formatSkewDuration(skew);
  if (skew > 0) {
    return [
      `Artifact skew: manifest.json is ${gap} NEWER than catalog.json.`,
      `The catalog predates your docs: columns and models you have already built AND documented can` +
        ` appear below as phantom columns or as missing from the catalog. Re-run \`dbt docs generate\`,` +
        ` then re-check, before acting on any finding.`,
    ];
  }
  return [
    `Artifact skew: catalog.json is ${gap} newer than manifest.json.`,
    `The manifest predates the warehouse snapshot, so any docs edited since were never compared and` +
      ` drift below may be under-reported. Re-run \`dbt docs generate\` before trusting what is missing here.`,
  ];
}

/**
 * The one-sentence skew caveat carried by SAVED proposals, or "" when the
 * artifacts are close enough (same gate as {@link artifactSkewLines}).
 *
 * Separate copy from the report warning for one reason: this text OUTLIVES
 * the run. Someone reads it in their Context Inbox weeks later with no report
 * around it, so it has to restate the gap and its direction rather than lean
 * on a header two screens up, and it must survive being read alone. It states
 * only what the skew data supports — how far apart, which file is newer, and
 * the consequence that follows — and never that the finding is wrong.
 *
 * Deliberately one sentence that reads correctly on BOTH a single-finding
 * proposal and the run-summary note, so the two can never drift apart.
 */
export function savedSkewCaveat(report: DriftReport): string {
  const { skew_seconds: skew, stale } = report.artifact_skew;
  if (!stale || skew === null) return "";
  const gap = formatSkewDuration(skew);
  return skew > 0
    ? ` Caveat: this run compared artifacts generated ${gap} apart (manifest.json newer), so findings may be` +
        ` artifacts of an out-of-date catalog rather than current drift.`
    : ` Caveat: this run compared artifacts generated ${gap} apart (catalog.json newer), so the two files` +
        ` describe different moments and drift may be under-reported.`;
}

/**
 * The terminal report's closing next step, shown only when the run found
 * something and did not already save it.
 *
 * Truthfulness rule (binding): this may describe what saving does TODAY —
 * stages proposals you review — and nothing beyond it. There is no tracking,
 * no updating, and no resolving of a finding when the drift is fixed, so no
 * line here may imply one.
 */
export function savePreviewCtaLines(): string[] {
  return [
    "Next: `npx clarilayer dbt-check --save --dry-run` prints the exact payload `--save` would send — no key, no network.",
    "`--save` stages these findings as proposals in your ClariLayer Context Inbox for you to review.",
  ];
}
