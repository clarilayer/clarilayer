/**
 * The docs-drift engine: parsed manifest + catalog in, DriftReport out.
 *
 * Pure — no I/O, no environment reads, deterministic output. Loading,
 * version gating, and size guards live in load.ts; rendering lives with the
 * CLI. Keeping this seam clean is what makes the rules testable one by one.
 *
 * Rules:
 * - Only manifest nodes with resource_type "model" are considered.
 * - Ephemeral models never materialize, so they are excluded from every
 *   warehouse comparison (including model_never_built).
 * - A non-ephemeral model absent from the catalog → model_never_built, and
 *   its columns are NOT column-checked (there is nothing to compare against).
 * - Column names are normalized on both sides before matching: trim, strip
 *   surrounding double quotes and backticks, lowercase.
 * - phantom_column: declared column absent from the model's actual columns;
 *   carries the closest actual column name when one looks like a rename.
 * - type_family_mismatch: only when BOTH the declared data_type and the
 *   catalog type map to known, different type families. Unknown types are
 *   never flagged.
 * - hollow_description: declared column (on a built model) whose description
 *   is empty or whitespace.
 */
import { typeFamily } from "./type-families.js";
import {
  FINDING_KIND_SEVERITY_ORDER,
  parseDbtSchemaVersion,
  type CoverageStats,
  type DbtCatalog,
  type DbtManifest,
  type DriftFinding,
  type DriftReport,
  type FindingIdentity,
  type ManifestNode,
} from "./types.js";

/**
 * Similarity floor for suggesting a phantom column's rename candidate
 * (1 - levenshtein/maxLen). 0.6 keeps genuine renames like `tag` → `tags`
 * (0.75) while rejecting unrelated names.
 */
const RENAME_SIMILARITY_THRESHOLD = 0.6;

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
 * Ties keep the earliest candidate in catalog order, so output is stable.
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

/** Analyze declared docs vs warehouse catalog. Pure; throws only on inputs
 * that violate the DbtManifest/DbtCatalog contract (missing metadata). */
export function analyzeDrift(manifest: DbtManifest, catalog: DbtCatalog): DriftReport {
  const manifestVersion = parseDbtSchemaVersion(manifest.metadata?.dbt_schema_version, "manifest");
  const catalogVersion = parseDbtSchemaVersion(catalog.metadata?.dbt_schema_version, "catalog");
  if (manifestVersion === null || catalogVersion === null) {
    throw new Error(
      "artifact metadata.dbt_schema_version is missing or unparseable — load artifacts via loadDbtArtifacts(), which validates them",
    );
  }

  const models = new Map<string, ManifestNode>();
  for (const [uniqueId, node] of Object.entries(manifest.nodes ?? {})) {
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
    if (node.config?.materialized === "ephemeral") {
      coverage.models.ephemeral++;
      continue;
    }

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

    const catalogNode = catalogNodes[uniqueId];
    if (catalogNode === undefined || catalogNode === null) {
      findings.push({ ...identity, kind: "model_never_built", column: null });
      continue;
    }
    coverage.models.built++;

    // Normalized actual columns, keeping the warehouse's original spelling.
    const actualByNorm = new Map<string, { original: string; type: string | null }>();
    for (const [actualName, actualCol] of Object.entries(catalogNode.columns ?? {})) {
      actualByNorm.set(normalizeColumnName(actualName), {
        original: actualName,
        type: actualCol?.type ?? null,
      });
    }
    coverage.columns.actual += actualByNorm.size;

    const declared = node.columns ?? {};
    const declaredNorms = new Set<string>();
    let anyDeclared = false;
    for (const [declaredName, declaredCol] of Object.entries(declared)) {
      anyDeclared = true;
      coverage.columns.declared++;
      const norm = normalizeColumnName(declaredName);
      declaredNorms.add(norm);

      if (!(declaredCol?.description ?? "").trim()) {
        coverage.hollow++;
        findings.push({ ...identity, kind: "hollow_description", column: declaredName });
      }

      const actual = actualByNorm.get(norm);
      if (actual === undefined) {
        findings.push({
          ...identity,
          kind: "phantom_column",
          column: declaredName,
          closest_actual: closestActualColumn(norm, actualByNorm),
        });
        continue;
      }

      const declaredType = declaredCol?.data_type;
      if (typeof declaredType === "string" && typeof actual.type === "string") {
        const declaredFamily = typeFamily(declaredType);
        const actualFamily = typeFamily(actual.type);
        if (declaredFamily !== null && actualFamily !== null && declaredFamily !== actualFamily) {
          findings.push({
            ...identity,
            kind: "type_family_mismatch",
            column: declaredName,
            declared_type: declaredType,
            actual_type: actual.type,
            declared_family: declaredFamily,
            actual_family: actualFamily,
          });
        }
      }
    }
    if (anyDeclared) coverage.models.documented++;
    for (const norm of actualByNorm.keys()) {
      if (!declaredNorms.has(norm)) coverage.columns.undocumented++;
    }
  }

  const rank = new Map(FINDING_KIND_SEVERITY_ORDER.map((kind, index) => [kind, index]));
  findings.sort(
    (a, b) =>
      (rank.get(a.kind) ?? 99) - (rank.get(b.kind) ?? 99) ||
      cmp(a.display_name, b.display_name) ||
      cmp(a.column ?? "", b.column ?? "") ||
      cmp(a.model_unique_id, b.model_unique_id),
  );

  return {
    project_name: manifest.metadata?.project_name ?? "",
    manifest_schema_version: manifestVersion,
    catalog_schema_version: catalogVersion,
    manifest_generated_at: manifest.metadata?.generated_at ?? null,
    catalog_generated_at: catalog.metadata?.generated_at ?? null,
    findings,
    coverage,
  };
}
