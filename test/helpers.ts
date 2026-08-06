/**
 * Shared fixture access for the test suite. Fixtures live in
 * test/fixtures/<name>/{manifest,catalog}.json — one drift scenario per
 * directory.
 */
import { after } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DbtArtifactKind, DbtCatalog, DbtManifest } from "../src/lib/dbt/types.js";

/** Absolute path to the fixture root. */
export const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

const tempDirs: string[] = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * Temp directory seeded with the given files (nested keys like
 * "target/manifest.json" allowed); removed after the importing test file runs.
 */
export function tempTargetDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "clarilayer-dbt-check-"));
  tempDirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  return dir;
}

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
