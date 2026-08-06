/**
 * The docs-drift finding model, plus the minimal structural shapes of the two
 * dbt artifacts it reads.
 *
 * `dbt-check` compares a dbt project's declared YAML docs (manifest.json)
 * against what the warehouse actually reports (catalog.json, produced by
 * `dbt docs generate`) and emits FINDINGS — concrete, per-model /
 * per-column drift facts. Coverage percentages are report metadata, not
 * findings: a finding is something to fix, a stat is something to know.
 */
import type { TypeFamily } from "./type-families.js";

// ---------------------------------------------------------------------------
// dbt artifact shapes (structural, permissive)
//
// Only the fields the drift engine reads. Real artifacts carry far more; we
// deliberately type them loosely so a field dbt adds in a minor release never
// breaks parsing.
// ---------------------------------------------------------------------------

/** The two dbt artifacts this tool reads. */
export type DbtArtifactKind = "manifest" | "catalog";

/** Shared metadata header both artifacts carry. */
export interface DbtArtifactMetadata {
  /** e.g. "https://schemas.getdbt.com/dbt/manifest/v12.json" */
  dbt_schema_version: string;
  generated_at?: string | null;
  project_name?: string | null;
  [key: string]: unknown;
}

/** A column declared in YAML docs, as recorded in the manifest. */
export interface ManifestColumn {
  name?: string | null;
  description?: string | null;
  data_type?: string | null;
  [key: string]: unknown;
}

/** A manifest node (we only act on resource_type === "model"). */
export interface ManifestNode {
  resource_type?: string;
  name?: string;
  package_name?: string;
  database?: string | null;
  schema?: string;
  alias?: string | null;
  patch_path?: string | null;
  original_file_path?: string | null;
  config?: { materialized?: string | null; [key: string]: unknown } | null;
  columns?: Record<string, ManifestColumn> | null;
  [key: string]: unknown;
}

export interface DbtManifest {
  metadata: DbtArtifactMetadata;
  nodes: Record<string, ManifestNode>;
  [key: string]: unknown;
}

/** A column as introspected from the warehouse. */
export interface CatalogColumn {
  type?: string | null;
  name?: string | null;
  [key: string]: unknown;
}

/** A catalog node, keyed (like manifest nodes) by unique_id. */
export interface CatalogNode {
  columns?: Record<string, CatalogColumn> | null;
  [key: string]: unknown;
}

export interface DbtCatalog {
  metadata: DbtArtifactMetadata;
  nodes: Record<string, CatalogNode>;
  [key: string]: unknown;
}

/**
 * Parse the numeric schema version out of a `metadata.dbt_schema_version`
 * URL, e.g. ".../dbt/manifest/v12.json" → 12. Returns null when the trailing
 * segment does not match `/{artifact}/v{N}.json`.
 */
export function parseDbtSchemaVersion(
  schemaVersionUrl: string | null | undefined,
  artifact: DbtArtifactKind,
): number | null {
  if (typeof schemaVersionUrl !== "string") return null;
  const match = schemaVersionUrl.trim().match(/\/(manifest|catalog)\/v(\d+)\.json$/);
  if (!match || match[1] !== artifact) return null;
  return Number.parseInt(match[2], 10);
}

/**
 * The schema-version matrix this engine is validated against.
 *
 * Manifest v10/v11/v12 = dbt-core 1.7 / 1.8 / 1.9+ (dbt has kept the
 * manifest at v12 since 1.9; catalog has been v1 since 1.0).
 *
 * Update drill when a new dbt minor introduces a new schema version:
 *   1. regenerate the test fixtures with that dbt version,
 *   2. extend this matrix (and fix whatever the tests catch),
 *   3. ship a patch release.
 */
export const SUPPORTED_DBT_SCHEMA_VERSIONS: Record<DbtArtifactKind, readonly number[]> = {
  manifest: [10, 11, 12],
  catalog: [1],
};

/**
 * Validate a raw `metadata.dbt_schema_version` value and return the parsed
 * numeric version. Throws a plain Error with the actionable message when the
 * version is missing, unparseable, or outside SUPPORTED_DBT_SCHEMA_VERSIONS.
 *
 * Both entrypoints call this — loadDbtArtifacts() (which wraps the message in
 * a DbtLoadError) and analyzeDrift() — so the file loader and the pure engine
 * cannot drift on which schema versions they accept.
 */
export function assertSupportedDbtSchemaVersion(
  rawSchemaVersion: unknown,
  artifact: DbtArtifactKind,
): number {
  const version = parseDbtSchemaVersion(
    typeof rawSchemaVersion === "string" ? rawSchemaVersion : null,
    artifact,
  );
  const supported = SUPPORTED_DBT_SCHEMA_VERSIONS[artifact];
  if (version === null || !supported.includes(version)) {
    const found =
      version !== null
        ? `v${version}`
        : `an unrecognized schema version (${JSON.stringify(rawSchemaVersion ?? null)})`;
    throw new Error(
      `${artifact}.json uses ${found}; this check supports ${artifact} schema ${supported
        .map((v) => `v${v}`)
        .join(", ")}. ` +
        `Regenerate the artifacts with a supported dbt version (manifest v10/v11/v12 = dbt-core 1.7+), ` +
        `or update the clarilayer CLI if your dbt is newer than it.`,
    );
  }
  return version;
}

/**
 * Severity order, most severe first. Renderers and exit-code policies sort
 * and threshold by index in THIS array — do not reorder without revisiting
 * every consumer.
 *
 * - phantom_column: docs describe a column the warehouse does not have — the
 *   docs are actively wrong, and an agent trusting them will write broken SQL.
 * - model_never_built: docs describe a model with no warehouse relation at
 *   all (never built, or dropped).
 * - type_family_mismatch: column exists but its declared type family differs
 *   from the warehouse's.
 * - hollow_description: column is declared but its description is empty —
 *   documentation theater rather than wrong docs.
 */
export const FINDING_KIND_SEVERITY_ORDER = [
  "phantom_column",
  "model_never_built",
  "type_family_mismatch",
  "hollow_description",
] as const;

/**
 * Every drift finding kind. Derived from FINDING_KIND_SEVERITY_ORDER so a new
 * kind cannot be added to the union without also getting a severity rank.
 */
export type FindingKind = (typeof FINDING_KIND_SEVERITY_ORDER)[number];

/**
 * Identity fields carried by EVERY finding, so any single finding is
 * self-describing: which model (fully qualified), which relation the
 * warehouse knows it as, which column, and which YAML file to edit.
 */
export interface FindingIdentity {
  /** Manifest unique_id, e.g. "model.jaffle_shop.orders". */
  model_unique_id: string;
  /** dbt package the model belongs to (project or an installed package). */
  package_name: string;
  /** Target database/catalog; null on adapters without one. */
  database: string | null;
  /** Target schema. */
  schema: string;
  /** Relation name in the warehouse (manifest alias, falling back to name). */
  alias: string;
  /** dbt model name. */
  model: string;
  /**
   * Human-facing model label: `{model}`, or `{package_name}.{model}` when the
   * bare model name is ambiguous in this project (the same model name exists
   * in more than one package).
   */
  display_name: string;
  /** Column the finding is about; null for model-level findings. */
  column: string | null;
  /**
   * YAML file that declared the docs (manifest patch_path, falling back to
   * the model's original_file_path). Display-only — a repo-relative hint for
   * "where to fix it", not a resolvable filesystem path.
   */
  yaml_path: string | null;
}

/** A documented column the warehouse does not have. */
export interface PhantomColumnFinding extends FindingIdentity {
  kind: "phantom_column";
  column: string;
  /**
   * Closest actual column name when one is similar enough to look like a
   * rename (e.g. declared `tag`, actual `tags`); null when nothing is close.
   */
  closest_actual: string | null;
}

/** A documented, non-ephemeral model with no relation in the catalog. */
export interface ModelNeverBuiltFinding extends FindingIdentity {
  kind: "model_never_built";
  column: null;
}

/** Declared and warehouse types resolve to different known type families. */
export interface TypeFamilyMismatchFinding extends FindingIdentity {
  kind: "type_family_mismatch";
  column: string;
  /** Raw declared `data_type` from the YAML docs. */
  declared_type: string;
  /** Raw type reported by the warehouse catalog. */
  actual_type: string;
  declared_family: TypeFamily;
  actual_family: TypeFamily;
}

/** A declared column whose description is empty or whitespace. */
export interface HollowDescriptionFinding extends FindingIdentity {
  kind: "hollow_description";
  column: string;
}

export type DriftFinding =
  | PhantomColumnFinding
  | ModelNeverBuiltFinding
  | TypeFamilyMismatchFinding
  | HollowDescriptionFinding;

/**
 * Report metadata: how much of the project the docs actually cover.
 * These are stats, not findings — they carry no severity and no identity.
 */
export interface CoverageStats {
  models: {
    /** Models in the manifest (includes ephemeral). */
    total: number;
    /** Ephemeral models — excluded from every warehouse comparison. */
    ephemeral: number;
    /** Non-ephemeral models present in the catalog. */
    built: number;
    /** Built models with at least one declared column. */
    documented: number;
  };
  columns: {
    /** Columns the warehouse reports across built models. */
    actual: number;
    /**
     * Columns declared in YAML docs across ALL models — ephemeral and
     * never-built included, since a YAML declaration exists regardless of
     * warehouse state. Counted per normalized name (first-wins on
     * duplicates), so `hollow` can never exceed it.
     */
    declared: number;
    /** Actual columns with no YAML declaration at all. */
    undocumented: number;
  };
  /** Declared columns whose description is empty or whitespace. */
  hollow: number;
}

/** The full result of one drift analysis. */
export interface DriftReport {
  /** dbt project name, from manifest metadata. */
  project_name: string;
  /** Parsed manifest schema version (e.g. 12). */
  manifest_schema_version: number;
  /** Parsed catalog schema version (e.g. 1). */
  catalog_schema_version: number;
  /** Manifest metadata.generated_at (as written by dbt); null if absent. */
  manifest_generated_at: string | null;
  /** Catalog metadata.generated_at (as written by dbt); null if absent. */
  catalog_generated_at: string | null;
  /**
   * All findings, sorted canonically: severity (per
   * FINDING_KIND_SEVERITY_ORDER), then display_name, then column.
   */
  findings: DriftFinding[];
  coverage: CoverageStats;
}
