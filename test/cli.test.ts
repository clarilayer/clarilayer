/**
 * Spawned-binary checks for `clarilayer dbt-check`: the stream contract
 * (stdout is the report and nothing else), the 0-or-2 exit codes, and the
 * routing seam around init. These run `node dist/index.js`, so the suite
 * builds dist first — never trusting a stale one from an earlier run.
 */
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURES, readFixtureText, tempTargetDir } from "./helpers.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist", "index.js");
const TSC = join(ROOT, "node_modules", "typescript", "bin", "tsc");

function run(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const res = spawnSync(process.execPath, [DIST, ...args], { encoding: "utf8", cwd: ROOT });
  return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", status: res.status };
}

describe("clarilayer dbt-check (spawned binary)", () => {
  before(() => {
    try {
      execFileSync(process.execPath, [TSC, "-p", join(ROOT, "tsconfig.json")], {
        encoding: "utf8",
        stdio: "pipe",
      });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      throw new Error(`building dist for the spawn tests failed:\n${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`);
    }
    assert.ok(existsSync(DIST));
  });

  test("--json: stdout is exactly the JSON document; human summary on stderr; exit 0", () => {
    const { stdout, stderr, status } = run([
      "dbt-check",
      "--json",
      "--target-path",
      join(FIXTURES, "phantom-column"),
    ]);
    assert.equal(status, 0);

    // Byte-exact purity: parsing and re-serializing with the CLI's own
    // formatting must reproduce stdout in full — zero non-JSON bytes.
    const report = JSON.parse(stdout) as {
      project_name: string;
      findings: Array<{ kind: string; column: string | null; closest_actual?: string | null }>;
      coverage: { models: { built: number } };
    };
    assert.equal(stdout, `${JSON.stringify(report, null, 2)}\n`);

    assert.equal(report.project_name, "fixture_phantom");
    assert.equal(report.findings.length, 2);
    assert.equal(report.findings[0].kind, "phantom_column");
    assert.equal(report.coverage.models.built, 1);

    assert.ok(stderr.length > 0, "expected a human summary on stderr");
    assert.ok(stderr.includes("2 drift findings: 2 phantom columns"));
  });

  test("missing catalog.json: actionable error on stderr, empty stdout, exit 2", () => {
    const { stdout, stderr, status } = run([
      "dbt-check",
      "--target-path",
      join(FIXTURES, "missing-catalog"),
    ]);
    assert.equal(status, 2);
    assert.equal(stdout, "");
    assert.ok(stderr.includes("catalog.json not found"));
    assert.ok(stderr.includes("dbt docs generate"));
  });

  test("--help mentions dbt-check, from both the global and the subcommand form", () => {
    for (const args of [["--help"], ["dbt-check", "--help"]]) {
      const { stdout, status } = run(args);
      assert.equal(status, 0);
      assert.ok(stdout.includes("dbt-check"), `expected dbt-check in help for ${args.join(" ")}`);
    }
  });

  test("--json --help keeps stdout empty and prints the help on stderr, exit 0", () => {
    const { stdout, stderr, status } = run(["dbt-check", "--json", "--help"]);
    assert.equal(status, 0);
    assert.equal(stdout, ""); // stdout stays pure for the JSON document under --json
    assert.ok(stderr.includes("dbt-check options"));
  });

  test("resolves <project-dir>/target by default and writes the --md report", () => {
    const dir = tempTargetDir({
      "target/manifest.json": readFixtureText("clean", "manifest"),
      "target/catalog.json": readFixtureText("clean", "catalog"),
    });
    const mdPath = join(dir, "drift-report.md");
    const { stdout, stderr, status } = run(["dbt-check", "--project-dir", dir, "--md", mdPath]);
    assert.equal(status, 0);
    assert.ok(stdout.includes("No drift found across 1 checked model."));
    assert.ok(!/verified/i.test(stdout));
    assert.ok(stderr.includes(mdPath)); // the write notice is status, not report
    const md = readFileSync(mdPath, "utf8");
    assert.ok(md.includes("fixture_clean"));
    assert.ok(!/verified/i.test(md));
  });

  test("usage errors exit 2 with the problem on stderr and nothing on stdout", () => {
    const unknown = run(["dbt-check", "--nope"]);
    assert.equal(unknown.status, 2);
    assert.equal(unknown.stdout, "");
    assert.ok(unknown.stderr.includes("--nope"));

    const badTop = run(["dbt-check", "--top", "abc", "--target-path", join(FIXTURES, "clean")]);
    assert.equal(badTop.status, 2);
    assert.ok(badTop.stderr.includes("--top"));
  });

  test("--flag=value forms parse; value-less flags reject an = payload", () => {
    const eq = run(["dbt-check", `--target-path=${join(FIXTURES, "clean")}`, "--top=0", "--json"]);
    assert.equal(eq.status, 0);
    const report = JSON.parse(eq.stdout) as { project_name: string };
    assert.equal(report.project_name, "fixture_clean");

    const jsonWithValue = run(["dbt-check", "--json=true", "--target-path", join(FIXTURES, "clean")]);
    assert.equal(jsonWithValue.status, 2);
    assert.equal(jsonWithValue.stdout, "");
    assert.ok(jsonWithValue.stderr.includes("--json=true"));

    const emptyValue = run(["dbt-check", "--md=", "--target-path", join(FIXTURES, "clean")]);
    assert.equal(emptyValue.status, 2);
    assert.equal(emptyValue.stdout, "");
    assert.ok(emptyValue.stderr.includes("--md requires a value"));
  });

  test("flags before the subcommand get the put-it-first hint, exit 2 (both orderings)", () => {
    for (const args of [
      ["--dry-run", "dbt-check"], // known init flag first
      ["--json", "dbt-check"], // flag unknown to init first
    ]) {
      const { stdout, stderr, status } = run(args);
      assert.equal(status, 2, args.join(" "));
      assert.equal(stdout, "", args.join(" "));
      assert.ok(
        stderr.includes("Put the subcommand first: npx clarilayer dbt-check"),
        args.join(" "),
      );
    }
  });

  test("unknown commands still take the init path's exit code 1 (routing unchanged)", () => {
    const { stdout, stderr, status } = run(["definitely-not-a-command"]);
    assert.equal(status, 1);
    assert.ok(stderr.includes("Unknown command"));
    assert.ok(stdout.includes("dbt-check")); // the help it prints names the new subcommand
  });
});
