import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeDrift } from "../src/lib/dbt/engine.js";
import {
  DEFAULT_MAX_ARTIFACT_BYTES,
  DbtLoadError,
  SUPPORTED_DBT_SCHEMA_VERSIONS,
  loadDbtArtifacts,
} from "../src/lib/dbt/load.js";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

const tempDirs: string[] = [];
function tempTargetDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "clarilayer-dbt-check-"));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const cleanManifest = () => readFileSync(join(FIXTURES, "clean", "manifest.json"), "utf8");
const cleanCatalog = () => readFileSync(join(FIXTURES, "clean", "catalog.json"), "utf8");

describe("loadDbtArtifacts", () => {
  test("loads a valid pair and feeds the engine end to end", () => {
    const { manifest, catalog, manifestPath, catalogPath } = loadDbtArtifacts(
      join(FIXTURES, "clean"),
    );
    assert.equal(manifest.metadata.project_name, "fixture_clean");
    assert.ok(manifestPath.endsWith("manifest.json"));
    assert.ok(catalogPath.endsWith("catalog.json"));
    const report = analyzeDrift(manifest, catalog);
    assert.deepEqual(report.findings, []);
  });

  test("exports the supported-version matrix and a positive default size cap", () => {
    assert.deepEqual(SUPPORTED_DBT_SCHEMA_VERSIONS.manifest, [10, 11, 12]);
    assert.deepEqual(SUPPORTED_DBT_SCHEMA_VERSIONS.catalog, [1]);
    assert.ok(Number.isFinite(DEFAULT_MAX_ARTIFACT_BYTES) && DEFAULT_MAX_ARTIFACT_BYTES > 0);
  });

  test("refuses a missing catalog.json and says to run dbt docs generate", () => {
    assert.throws(
      () => loadDbtArtifacts(join(FIXTURES, "missing-catalog")),
      (err: unknown) =>
        err instanceof DbtLoadError &&
        err.code === "missing_artifact" &&
        err.artifact === "catalog" &&
        /dbt docs generate/.test(err.message),
    );
  });

  test("refuses a missing manifest.json (and a missing directory) actionably", () => {
    const empty = tempTargetDir({});
    for (const dir of [empty, join(empty, "does-not-exist")]) {
      assert.throws(
        () => loadDbtArtifacts(dir),
        (err: unknown) =>
          err instanceof DbtLoadError &&
          err.code === "missing_artifact" &&
          err.artifact === "manifest" &&
          err.message.includes("manifest.json not found"),
      );
    }
  });

  test("refuses an unsupported (older) manifest schema version, naming found and supported", () => {
    assert.throws(
      () => loadDbtArtifacts(join(FIXTURES, "unsupported-version")),
      (err: unknown) =>
        err instanceof DbtLoadError &&
        err.code === "unsupported_schema_version" &&
        err.artifact === "manifest" &&
        err.message.includes("v9") &&
        err.message.includes("v10, v11, v12") &&
        /[Rr]egenerate/.test(err.message),
    );
  });

  test("refuses an unknown (newer) manifest schema version rather than guessing", () => {
    const dir = tempTargetDir({
      "manifest.json": cleanManifest().replace("/manifest/v12.json", "/manifest/v13.json"),
      "catalog.json": cleanCatalog(),
    });
    assert.throws(
      () => loadDbtArtifacts(dir),
      (err: unknown) =>
        err instanceof DbtLoadError &&
        err.code === "unsupported_schema_version" &&
        err.artifact === "manifest" &&
        err.message.includes("v13"),
    );
  });

  test("refuses an unsupported catalog schema version", () => {
    const dir = tempTargetDir({
      "manifest.json": cleanManifest(),
      "catalog.json": cleanCatalog().replace("/catalog/v1.json", "/catalog/v2.json"),
    });
    assert.throws(
      () => loadDbtArtifacts(dir),
      (err: unknown) =>
        err instanceof DbtLoadError &&
        err.code === "unsupported_schema_version" &&
        err.artifact === "catalog" &&
        err.message.includes("v2") &&
        err.message.includes("v1"),
    );
  });

  test("size guard: refuses before parsing when a file exceeds maxBytes", () => {
    assert.throws(
      () => loadDbtArtifacts(join(FIXTURES, "clean"), { maxBytes: 64 }),
      (err: unknown) =>
        err instanceof DbtLoadError &&
        err.code === "artifact_too_large" &&
        err.artifact === "manifest" &&
        err.message.includes("limit"),
    );
  });

  test("refuses invalid JSON with a regenerate hint", () => {
    const dir = tempTargetDir({
      "manifest.json": "{ this is not json",
      "catalog.json": cleanCatalog(),
    });
    assert.throws(
      () => loadDbtArtifacts(dir),
      (err: unknown) =>
        err instanceof DbtLoadError &&
        err.code === "invalid_artifact" &&
        err.artifact === "manifest" &&
        err.message.includes("not valid JSON"),
    );
  });

  test("refuses valid JSON that is not a dbt artifact shape", () => {
    const dir = tempTargetDir({
      "manifest.json": JSON.stringify({ metadata: { dbt_schema_version: "x" } }),
      "catalog.json": cleanCatalog(),
    });
    assert.throws(
      () => loadDbtArtifacts(dir),
      (err: unknown) =>
        err instanceof DbtLoadError &&
        err.code === "invalid_artifact" &&
        err.artifact === "manifest" &&
        err.message.includes("does not look like a dbt manifest"),
    );
  });
});
