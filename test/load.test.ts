import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeDrift } from "../src/lib/dbt/engine.js";
import {
  DEFAULT_MAX_ARTIFACT_BYTES,
  DbtLoadError,
  SUPPORTED_DBT_SCHEMA_VERSIONS,
  loadDbtArtifacts,
  type DbtLoadErrorCode,
} from "../src/lib/dbt/load.js";
import type { DbtArtifactKind } from "../src/lib/dbt/types.js";
import { FIXTURES, fixture, readFixtureText } from "./helpers.js";

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

const cleanManifestText = readFixtureText("clean", "manifest");
const cleanCatalogText = readFixtureText("clean", "catalog");

/** The three-clause DbtLoadError contract every refusal test asserts first. */
function isLoadError(
  err: unknown,
  code: DbtLoadErrorCode,
  artifact: DbtArtifactKind,
): err is DbtLoadError {
  return err instanceof DbtLoadError && err.code === code && err.artifact === artifact;
}

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
        isLoadError(err, "missing_artifact", "catalog") && /dbt docs generate/.test(err.message),
    );
  });

  test("refuses a missing manifest.json (and a missing directory) actionably", () => {
    const empty = tempTargetDir({});
    for (const dir of [empty, join(empty, "does-not-exist")]) {
      assert.throws(
        () => loadDbtArtifacts(dir),
        (err: unknown) =>
          isLoadError(err, "missing_artifact", "manifest") &&
          err.message.includes("manifest.json not found"),
      );
    }
  });

  test("refuses an unsupported (older) manifest schema version, naming found and supported", () => {
    assert.throws(
      () => loadDbtArtifacts(join(FIXTURES, "unsupported-version")),
      (err: unknown) =>
        isLoadError(err, "unsupported_schema_version", "manifest") &&
        err.message.includes("v9") &&
        err.message.includes("v10, v11, v12") &&
        /[Rr]egenerate/.test(err.message),
    );
  });

  test("refuses an unknown (newer) manifest schema version rather than guessing", () => {
    const dir = tempTargetDir({
      "manifest.json": cleanManifestText.replace("/manifest/v12.json", "/manifest/v13.json"),
      "catalog.json": cleanCatalogText,
    });
    assert.throws(
      () => loadDbtArtifacts(dir),
      (err: unknown) =>
        isLoadError(err, "unsupported_schema_version", "manifest") && err.message.includes("v13"),
    );
  });

  test("refuses an unsupported catalog schema version", () => {
    const dir = tempTargetDir({
      "manifest.json": cleanManifestText,
      "catalog.json": cleanCatalogText.replace("/catalog/v1.json", "/catalog/v2.json"),
    });
    assert.throws(
      () => loadDbtArtifacts(dir),
      (err: unknown) =>
        isLoadError(err, "unsupported_schema_version", "catalog") &&
        err.message.includes("v2") &&
        err.message.includes("v1"),
    );
  });

  test("loader and engine refuse an unsupported version with the same actionable message", () => {
    let loaderMessage = "";
    try {
      loadDbtArtifacts(join(FIXTURES, "unsupported-version"));
    } catch (err) {
      assert.ok(isLoadError(err, "unsupported_schema_version", "manifest"));
      loaderMessage = err.message;
    }

    let engineMessage = "";
    const { manifest, catalog } = fixture("unsupported-version");
    try {
      analyzeDrift(manifest, catalog);
    } catch (err) {
      engineMessage = err instanceof Error ? err.message : "";
    }

    // Both must actually have refused (an empty == empty pass would be
    // vacuous), with byte-identical guidance.
    assert.ok(loaderMessage.length > 0);
    assert.ok(engineMessage.length > 0);
    assert.equal(engineMessage, loaderMessage);
  });

  test("size guard: refuses an oversized file BEFORE parsing it", () => {
    // The oversized manifest is deliberately NOT valid JSON: a loader that
    // parsed first and size-checked after would report invalid_artifact
    // here instead of artifact_too_large.
    const dir = tempTargetDir({
      "manifest.json": "definitely not json. ".repeat(8), // 168 bytes > 64
      "catalog.json": cleanCatalogText,
    });
    assert.throws(
      () => loadDbtArtifacts(dir, { maxBytes: 64 }),
      (err: unknown) => isLoadError(err, "artifact_too_large", "manifest") && err.message.includes("limit"),
    );
  });

  test("size guard: a file exactly at maxBytes is allowed", () => {
    const dir = tempTargetDir({
      "manifest.json": cleanManifestText,
      "catalog.json": cleanCatalogText,
    });
    // Cap at the larger artifact's on-disk size, so that file sits exactly
    // AT the limit (size == maxBytes), not under it.
    const maxBytes = Math.max(
      statSync(join(dir, "manifest.json")).size,
      statSync(join(dir, "catalog.json")).size,
    );
    const { manifest } = loadDbtArtifacts(dir, { maxBytes });
    assert.equal(manifest.metadata.project_name, "fixture_clean");
  });

  test("refuses invalid JSON with a regenerate hint", () => {
    const dir = tempTargetDir({
      "manifest.json": "{ this is not json",
      "catalog.json": cleanCatalogText,
    });
    assert.throws(
      () => loadDbtArtifacts(dir),
      (err: unknown) =>
        isLoadError(err, "invalid_artifact", "manifest") && err.message.includes("not valid JSON"),
    );
  });

  test("refuses valid JSON that is not a dbt artifact shape", () => {
    const dir = tempTargetDir({
      "manifest.json": JSON.stringify({ metadata: { dbt_schema_version: "x" } }),
      "catalog.json": cleanCatalogText,
    });
    assert.throws(
      () => loadDbtArtifacts(dir),
      (err: unknown) =>
        isLoadError(err, "invalid_artifact", "manifest") &&
        err.message.includes("does not look like a dbt manifest"),
    );
  });
});
