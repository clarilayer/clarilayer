/**
 * Shared fixture access for the test suite. Fixtures live in
 * test/fixtures/<name>/{manifest,catalog}.json — one drift scenario per
 * directory.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DbtArtifactKind, DbtCatalog, DbtManifest } from "../src/lib/dbt/types.js";

/** Absolute path to the fixture root. */
export const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

/** Raw text of one artifact file in a named fixture directory. */
export function readFixtureText(name: string, artifact: DbtArtifactKind): string {
  return readFileSync(join(FIXTURES, name, `${artifact}.json`), "utf8");
}

/** Parsed manifest + catalog pair for a named fixture directory. */
export function fixture(name: string): { manifest: DbtManifest; catalog: DbtCatalog } {
  return {
    manifest: JSON.parse(readFixtureText(name, "manifest")),
    catalog: JSON.parse(readFixtureText(name, "catalog")),
  };
}
