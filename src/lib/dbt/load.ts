/**
 * Locate and parse a dbt project's target artifacts (manifest.json +
 * catalog.json), with hard gates in front of the drift engine:
 *
 * - both files must exist (catalog.json only comes from `dbt docs generate`),
 * - each file must be under the size cap (checked by stat, BEFORE parsing),
 * - each must be valid JSON with the artifact's basic shape,
 * - each must carry a schema version this engine was validated against.
 *
 * On any violation we refuse with an actionable error — never a partial
 * report. A drift report computed from an artifact shape we have not
 * validated would be guesswork wearing a report's clothes.
 */
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseDbtSchemaVersion, type DbtCatalog, type DbtManifest } from "./types.js";

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
export const SUPPORTED_DBT_SCHEMA_VERSIONS: Record<"manifest" | "catalog", readonly number[]> = {
  manifest: [10, 11, 12],
  catalog: [1],
};

/**
 * Default per-file size cap. Real manifests run tens of MB; 300 MB is far
 * past any project we have seen, and the perf gate (scripts/
 * gen-large-manifest.mjs fixtures) verifies a cap-size artifact still loads
 * and analyzes in interactive time. Lower this before raising it.
 */
export const DEFAULT_MAX_ARTIFACT_BYTES = 300 * 1024 * 1024;

export type DbtLoadErrorCode =
  | "missing_artifact"
  | "artifact_too_large"
  | "invalid_artifact"
  | "unsupported_schema_version";

/** Loader refusal: which artifact, why, and (in message) what to do. */
export class DbtLoadError extends Error {
  readonly code: DbtLoadErrorCode;
  readonly artifact: "manifest" | "catalog";

  constructor(code: DbtLoadErrorCode, artifact: "manifest" | "catalog", message: string) {
    super(message);
    this.name = "DbtLoadError";
    this.code = code;
    this.artifact = artifact;
  }
}

export interface LoadedDbtArtifacts {
  manifest: DbtManifest;
  catalog: DbtCatalog;
  manifestPath: string;
  catalogPath: string;
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Stat the artifact; missing file / directory → actionable refusal. */
function statArtifact(path: string, artifact: "manifest" | "catalog", targetDir: string): number {
  try {
    return statSync(path).size;
  } catch {
    const hint =
      artifact === "catalog"
        ? 'catalog.json is only produced by "dbt docs generate" (dbt run/build alone does not write it). Run "dbt docs generate", then retry.'
        : 'Run "dbt docs generate" in your dbt project, then point this check at the project\'s target/ directory.';
    throw new DbtLoadError(
      "missing_artifact",
      artifact,
      `${artifact}.json not found in ${targetDir}. ${hint}`,
    );
  }
}

function loadArtifactJson(
  path: string,
  artifact: "manifest" | "catalog",
  targetDir: string,
  size: number,
  maxBytes: number,
): Record<string, unknown> {
  if (size > maxBytes) {
    throw new DbtLoadError(
      "artifact_too_large",
      artifact,
      `${artifact}.json is ${formatMb(size)}, over the ${formatMb(maxBytes)} limit this check will parse. ` +
        `If this is a real project artifact (not a corrupted file), please open an issue so we can raise the cap deliberately.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new DbtLoadError(
      "invalid_artifact",
      artifact,
      `${artifact}.json in ${targetDir} is not valid JSON. Regenerate it with "dbt docs generate" and retry.`,
    );
  }

  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof (parsed as Record<string, unknown>).metadata !== "object" ||
    (parsed as Record<string, unknown>).metadata === null ||
    typeof (parsed as Record<string, unknown>).nodes !== "object" ||
    (parsed as Record<string, unknown>).nodes === null
  ) {
    throw new DbtLoadError(
      "invalid_artifact",
      artifact,
      `${artifact}.json in ${targetDir} does not look like a dbt ${artifact} (missing metadata/nodes). ` +
        `Regenerate it with "dbt docs generate" and retry.`,
    );
  }
  return parsed as Record<string, unknown>;
}

function assertSupportedVersion(
  parsed: Record<string, unknown>,
  artifact: "manifest" | "catalog",
): void {
  const raw = (parsed.metadata as Record<string, unknown>).dbt_schema_version;
  const version = parseDbtSchemaVersion(typeof raw === "string" ? raw : null, artifact);
  const supported = SUPPORTED_DBT_SCHEMA_VERSIONS[artifact];
  if (version === null || !supported.includes(version)) {
    const found = version !== null ? `v${version}` : `an unrecognized schema version (${JSON.stringify(raw ?? null)})`;
    throw new DbtLoadError(
      "unsupported_schema_version",
      artifact,
      `${artifact}.json uses ${found}; this check supports ${artifact} schema ${supported
        .map((v) => `v${v}`)
        .join(", ")}. ` +
        `Regenerate the artifacts with a supported dbt version (manifest v10/v11/v12 = dbt-core 1.7+), ` +
        `or update the clarilayer CLI if your dbt is newer than it.`,
    );
  }
}

/**
 * Load manifest.json + catalog.json from a dbt target directory.
 *
 * @param targetDir directory containing the artifacts (a project's `target/`).
 * @param options.maxBytes per-file size cap (default DEFAULT_MAX_ARTIFACT_BYTES).
 * @throws DbtLoadError on missing, oversized, malformed, or unsupported input.
 */
export function loadDbtArtifacts(
  targetDir: string,
  options: { maxBytes?: number } = {},
): LoadedDbtArtifacts {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_ARTIFACT_BYTES;
  const dir = resolve(targetDir);
  const manifestPath = join(dir, "manifest.json");
  const catalogPath = join(dir, "catalog.json");

  // Existence first (stat doubles as the size read), so a missing catalog is
  // reported as "run dbt docs generate" rather than as a parse problem.
  const manifestSize = statArtifact(manifestPath, "manifest", dir);
  const catalogSize = statArtifact(catalogPath, "catalog", dir);

  const manifestJson = loadArtifactJson(manifestPath, "manifest", dir, manifestSize, maxBytes);
  assertSupportedVersion(manifestJson, "manifest");
  const catalogJson = loadArtifactJson(catalogPath, "catalog", dir, catalogSize, maxBytes);
  assertSupportedVersion(catalogJson, "catalog");

  return {
    manifest: manifestJson as unknown as DbtManifest,
    catalog: catalogJson as unknown as DbtCatalog,
    manifestPath,
    catalogPath,
  };
}
