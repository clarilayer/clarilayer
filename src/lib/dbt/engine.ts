/**
 * The docs-drift engine: parsed manifest + catalog in, DriftReport out.
 *
 * Pure — no I/O, no environment reads, deterministic output. Loading and
 * size guards live in load.ts; rendering lives with the CLI. Both entrypoints
 * enforce the supported schema-version matrix (via
 * assertSupportedDbtSchemaVersion), so the pure engine hard-fails on
 * artifacts the loader would refuse. Keeping this seam clean is what makes
 * the rules testable one by one.
 *
 * Rules:
 * - Only manifest nodes with resource_type "model" are considered.
 * - hollow_description: declared column whose description is empty or
 *   whitespace. A YAML-doc finding — it needs no warehouse side, so it fires
 *   for ephemeral and never-built models too.
 * - Ephemeral models never materialize, so they are excluded from every
 *   warehouse comparison (including model_never_built).
 * - A non-ephemeral model absent from the catalog → model_never_built, and
 *   its columns get no warehouse checks (there is nothing to compare
 *   against).
 * - Column names are normalized on both sides before matching: trim, strip
 *   surrounding double quotes and backticks, lowercase. When two spellings
 *   collapse to one normalized name (rare, but e.g. Snowflake permits
 *   quoted, case-distinct columns), the first over the byte-sorted original
 *   keys wins — on both the declared and the actual side.
 * - phantom_column: declared column absent from the model's actual columns;
 *   carries the closest actual column name when one looks like a rename.
 * - type_family_mismatch: only when BOTH the declared data_type and the
 *   catalog type map to known, different type families. Unknown types are
 *   never flagged.
 *
 * Report metadata (neither rules nor findings): the coverage counts, and
 * artifact_skew — every rule above assumes the two artifacts describe the
 * same moment, so the report also carries how far apart they were generated
 * (see computeArtifactSkew). Skew changes no rule, no count, no exit code.
 */
import { typeFamily } from "./type-families.js";
import {
  ARTIFACT_SKEW_STALE_SECONDS,
  FINDING_KIND_SEVERITY_ORDER,
  assertSupportedDbtSchemaVersion,
  type ArtifactSkew,
  type CoverageStats,
  type DbtCatalog,
  type DbtManifest,
  type DriftFinding,
  type DriftReport,
  type FindingIdentity,
  type ManifestColumn,
  type ManifestNode,
} from "./types.js";

/**
 * Similarity floor for suggesting a phantom column's rename candidate
 * (1 - levenshtein/maxLen). 0.6 keeps genuine renames like `tag` → `tags`
 * (0.75) while rejecting unrelated names.
 */
const RENAME_SIMILARITY_THRESHOLD = 0.6;

/**
 * Milliseconds for an ISO stamp dbt wrote, or null when it is absent or
 * unparseable. Number.isFinite FIRST: Date.parse returns NaN for junk, and
 * every comparison against NaN is false, so an unguarded NaN would sail
 * through the |skew| bound below as "not stale" rather than "unknown".
 */
function parseTimestampMs(value: string | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * How far apart the two artifacts were generated. Pure and total: a missing
 * or unparseable stamp on either side yields a null skew (unknown), never a
 * zero one, and `stale` stays false because an unknown gap is not evidence
 * of a large one.
 *
 * Sign convention (load-bearing — the warning wording branches on it):
 * POSITIVE means the MANIFEST is newer, i.e. the catalog is the stale side.
 */
export function computeArtifactSkew(
  manifestGeneratedAt: string | null,
  catalogGeneratedAt: string | null,
): ArtifactSkew {
  const manifestMs = parseTimestampMs(manifestGeneratedAt);
  const catalogMs = parseTimestampMs(catalogGeneratedAt);
  const skewSeconds =
    manifestMs === null || catalogMs === null
      ? null
      : Math.round((manifestMs - catalogMs) / 1000);
  return {
    manifest_generated_at: manifestGeneratedAt,
    catalog_generated_at: catalogGeneratedAt,
    skew_seconds: skewSeconds,
    // "Unknown is not stale" holds by construction here rather than as a
    // second hardcoded `false` in a branch that would have to be kept in
    // sync with this one.
    stale: skewSeconds !== null && Math.abs(skewSeconds) > ARTIFACT_SKEW_STALE_SECONDS,
  };
}

/** Normalize a column name for matching: trim, strip `"` / backticks, lowercase. */
export function normalizeColumnName(name: string): string {
  return name.trim().replace(/^["`]+|["`]+$/g, "").trim().toLowerCase();
}

/** Classic two-row Levenshtein edit distance. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Best rename candidate for a missing declared column, or null. Compares
 * normalized names; returns the candidate's original (warehouse) spelling.
 * Ties keep the earliest candidate in the map's (byte-sorted) insertion
 * order, so output is stable.
 */
function closestActualColumn(
  normalizedDeclared: string,
  actualByNorm: Map<string, { original: string; type: string | null }>,
): string | null {
  let best: string | null = null;
  let bestSimilarity = 0;
  for (const [normActual, info] of actualByNorm) {
    const maxLen = Math.max(normalizedDeclared.length, normActual.length);
    if (maxLen === 0) continue;
    // Edit distance is at least the length difference, so this bound rules
    // out a candidate before paying for the DP.
    if (1 - Math.abs(normalizedDeclared.length - normActual.length) / maxLen < RENAME_SIMILARITY_THRESHOLD) {
      continue;
    }
    const similarity = 1 - levenshtein(normalizedDeclared, normActual) / maxLen;
    if (similarity >= RENAME_SIMILARITY_THRESHOLD && similarity > bestSimilarity) {
      best = info.original;
      bestSimilarity = similarity;
    }
  }
  return best;
}

/** Byte-wise string compare (avoids locale-dependent ordering). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** display_name per model: bare name, package-qualified when ambiguous. */
function buildDisplayNames(models: Map<string, ManifestNode>): Map<string, string> {
  const packagesByName = new Map<string, Set<string>>();
  for (const node of models.values()) {
    const name = node.name ?? "";
    let packages = packagesByName.get(name);
    if (!packages) packagesByName.set(name, (packages = new Set()));
    packages.add(node.package_name ?? "");
  }
  const displayNames = new Map<string, string>();
  for (const [uniqueId, node] of models) {
    const name = node.name ?? "";
    const ambiguous = (packagesByName.get(name)?.size ?? 0) > 1;
    displayNames.set(uniqueId, ambiguous ? `${node.package_name ?? ""}.${name}` : name);
  }
  return displayNames;
}

/** Analyze declared docs vs warehouse catalog. Pure; throws (with the same
 * actionable message as loadDbtArtifacts) when either artifact's schema
 * version is missing, unparseable, or unsupported. */
export function analyzeDrift(manifest: DbtManifest, catalog: DbtCatalog): DriftReport {
  const manifestVersion = assertSupportedDbtSchemaVersion(
    manifest.metadata?.dbt_schema_version,
    "manifest",
  );
  const catalogVersion = assertSupportedDbtSchemaVersion(
    catalog.metadata?.dbt_schema_version,
    "catalog",
  );

  const models = new Map<string, ManifestNode>();
  // Object.keys, not Object.entries: nodes is the artifact's largest object,
  // and entries would allocate a [key, value] tuple per node (tests, seeds,
  // snapshots included) just to filter down to models.
  const manifestNodes = manifest.nodes ?? {};
  for (const uniqueId of Object.keys(manifestNodes)) {
    const node = manifestNodes[uniqueId];
    if (node?.resource_type === "model") models.set(uniqueId, node);
  }
  const displayNames = buildDisplayNames(models);
  const catalogNodes = catalog.nodes ?? {};

  const findings: DriftFinding[] = [];
  const coverage: CoverageStats = {
    models: { total: models.size, ephemeral: 0, built: 0, documented: 0 },
    columns: { actual: 0, declared: 0, undocumented: 0 },
    hollow: 0,
  };

  for (const [uniqueId, node] of models) {
    const identity: FindingIdentity = {
      model_unique_id: uniqueId,
      package_name: node.package_name ?? "",
      database: node.database ?? null,
      schema: node.schema ?? "",
      alias: node.alias ?? node.name ?? "",
      model: node.name ?? "",
      display_name: displayNames.get(uniqueId) ?? node.name ?? "",
      column: null,
      yaml_path: node.patch_path ?? node.original_file_path ?? null,
    };

    // Declared columns by normalized name. When two spellings collapse to one
    // normalized name (rare, but e.g. Snowflake permits quoted, case-distinct
    // columns), the first over the byte-sorted original keys wins —
    // deterministic, never object-order last-write-wins. Same policy as the
    // actual side below.
    const declaredColumns = node.columns ?? {};
    const declaredByNorm = new Map<string, { original: string; column: ManifestColumn }>();
    for (const declaredName of Object.keys(declaredColumns).sort(cmp)) {
      const norm = normalizeColumnName(declaredName);
      if (!declaredByNorm.has(norm)) {
        declaredByNorm.set(norm, { original: declaredName, column: declaredColumns[declaredName] });
      }
    }

    // hollow_description is a YAML-doc finding: it needs no warehouse side,
    // so it fires before — and regardless of — the ephemeral and
    // missing-from-catalog branches below.
    for (const { original, column } of declaredByNorm.values()) {
      coverage.columns.declared++;
      if (!(column?.description ?? "").trim()) {
        findings.push({ ...identity, kind: "hollow_description", column: original });
      }
    }

    // Everything past this point compares against the warehouse. Ephemeral
    // models never materialize, so they are excluded from all of it
    // (including model_never_built).
    if (node.config?.materialized === "ephemeral") {
      coverage.models.ephemeral++;
      continue;
    }

    const catalogNode = catalogNodes[uniqueId];
    if (catalogNode === undefined || catalogNode === null) {
      findings.push({ ...identity, kind: "model_never_built", column: null });
      continue;
    }
    coverage.models.built++;
    if (declaredByNorm.size > 0) coverage.models.documented++;

    // Actual (warehouse) columns by normalized name, keeping the original
    // spelling. First-wins over the byte-sorted original keys, as above.
    const actualColumns = catalogNode.columns ?? {};
    const actualByNorm = new Map<string, { original: string; type: string | null }>();
    for (const actualName of Object.keys(actualColumns).sort(cmp)) {
      const norm = normalizeColumnName(actualName);
      if (!actualByNorm.has(norm)) {
        actualByNorm.set(norm, {
          original: actualName,
          type: actualColumns[actualName]?.type ?? null,
        });
      }
    }
    coverage.columns.actual += actualByNorm.size;

    for (const [norm, { original, column }] of declaredByNorm) {
      const actual = actualByNorm.get(norm);
      if (actual === undefined) {
        findings.push({
          ...identity,
          kind: "phantom_column",
          column: original,
          closest_actual: closestActualColumn(norm, actualByNorm),
        });
        continue;
      }

      const declaredType = column?.data_type;
      if (typeof declaredType === "string" && typeof actual.type === "string") {
        const declaredFamily = typeFamily(declaredType);
        const actualFamily = typeFamily(actual.type);
        if (declaredFamily !== null && actualFamily !== null && declaredFamily !== actualFamily) {
          findings.push({
            ...identity,
            kind: "type_family_mismatch",
            column: original,
            declared_type: declaredType,
            actual_type: actual.type,
            declared_family: declaredFamily,
            actual_family: actualFamily,
          });
        }
      }
    }
    for (const norm of actualByNorm.keys()) {
      if (!declaredByNorm.has(norm)) coverage.columns.undocumented++;
    }
  }

  // Derived, not counted next to the push, so the stat can never drift from
  // the findings it summarizes.
  coverage.hollow = findings.filter((f) => f.kind === "hollow_description").length;

  findings.sort(
    (a, b) =>
      FINDING_KIND_SEVERITY_ORDER.indexOf(a.kind) - FINDING_KIND_SEVERITY_ORDER.indexOf(b.kind) ||
      cmp(a.display_name, b.display_name) ||
      cmp(a.column ?? "", b.column ?? "") ||
      cmp(a.model_unique_id, b.model_unique_id),
  );

  const manifestGeneratedAt = manifest.metadata?.generated_at ?? null;
  const catalogGeneratedAt = catalog.metadata?.generated_at ?? null;

  return {
    project_name: manifest.metadata?.project_name ?? "",
    manifest_schema_version: manifestVersion,
    catalog_schema_version: catalogVersion,
    manifest_generated_at: manifestGeneratedAt,
    catalog_generated_at: catalogGeneratedAt,
    artifact_skew: computeArtifactSkew(manifestGeneratedAt, catalogGeneratedAt),
    findings,
    coverage,
  };
}
