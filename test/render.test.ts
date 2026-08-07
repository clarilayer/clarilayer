import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DOCS_URL, SIGNUP_URL } from "../src/lib/constants.js";
import { analyzeDrift } from "../src/lib/dbt/engine.js";
import { renderMarkdownReport } from "../src/lib/dbt/render-md.js";
import { DEFAULT_TOP_PER_SECTION, renderTtyReport } from "../src/lib/dbt/render-tty.js";
import type { DbtCatalog, DbtManifest } from "../src/lib/dbt/types.js";
import { fixture } from "./helpers.js";

// A report exercising all four finding kinds at once, with enough phantom
// and hollow findings to overflow a small --top cap: 3 phantom (one with a
// rename candidate), 1 never built, 1 type mismatch, 4 hollow.
const kitchenManifest: DbtManifest = {
  metadata: {
    dbt_schema_version: "https://schemas.getdbt.com/dbt/manifest/v12.json",
    project_name: "kitchen_sink",
    generated_at: "2026-02-01T00:00:00Z",
  },
  nodes: {
    "model.kitchen.alpha": {
      resource_type: "model",
      name: "alpha",
      package_name: "kitchen",
      database: "analytics",
      schema: "core",
      alias: "alpha",
      patch_path: "kitchen://models/_alpha.yml",
      original_file_path: "models/alpha.sql",
      config: { materialized: "table" },
      columns: {
        gone_a: { name: "gone_a", description: "First phantom.", data_type: null },
        gone_b: { name: "gone_b", description: "Second phantom.", data_type: null },
        tag: { name: "tag", description: "Third phantom, renamed in the warehouse.", data_type: null },
        amount: { name: "amount", description: "Type drifted.", data_type: "text" },
        h1: { name: "h1", description: "", data_type: null },
        h2: { name: "h2", description: "   ", data_type: null },
        h3: { name: "h3", description: "", data_type: null },
        h4: { name: "h4", description: "", data_type: null },
      },
    },
    "model.kitchen.beta": {
      resource_type: "model",
      name: "beta",
      package_name: "kitchen",
      database: "analytics",
      schema: "core",
      alias: "beta",
      patch_path: "kitchen://models/_beta.yml",
      original_file_path: "models/beta.sql",
      config: { materialized: "table" },
      columns: { ok_col: { name: "ok_col", description: "Documented fine.", data_type: null } },
    },
  },
};
const kitchenCatalog: DbtCatalog = {
  metadata: {
    dbt_schema_version: "https://schemas.getdbt.com/dbt/catalog/v1.json",
    generated_at: "2026-02-01T00:05:00Z",
  },
  nodes: {
    "model.kitchen.alpha": {
      columns: {
        tags: { type: "VARCHAR", name: "tags" },
        amount: { type: "NUMERIC(38,2)", name: "amount" },
        h1: { type: "VARCHAR", name: "h1" },
        h2: { type: "VARCHAR", name: "h2" },
        h3: { type: "VARCHAR", name: "h3" },
        h4: { type: "VARCHAR", name: "h4" },
        stray: { type: "VARCHAR", name: "stray" },
      },
    },
    // beta is deliberately absent: model_never_built.
  },
};

const kitchen = analyzeDrift(kitchenManifest, kitchenCatalog);
const clean = analyzeDrift(fixture("clean").manifest, fixture("clean").catalog);
const phantom = analyzeDrift(fixture("phantom-column").manifest, fixture("phantom-column").catalog);

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function lastLine(out: string): string {
  const lines = out.trimEnd().split("\n");
  return lines[lines.length - 1];
}

describe("renderTtyReport", () => {
  const full = renderTtyReport(kitchen, { top: DEFAULT_TOP_PER_SECTION });

  test("sections run in severity order and the ONE coverage line is last", () => {
    const markers = [
      "9 drift findings: 3 phantom columns, 1 model never built, 1 type family mismatch, 4 hollow descriptions",
      "Phantom columns (3)",
      "Models never built (1)",
      "Type family mismatches (1)",
      "Hollow descriptions (4)",
      "Not checked:",
      "Coverage:",
    ];
    let last = -1;
    for (const marker of markers) {
      const at = full.indexOf(marker);
      assert.ok(at > last, `expected "${marker}" after position ${last}, got ${at}`);
      last = at;
    }
    assert.ok(lastLine(full).startsWith("Coverage: "));
    assert.equal(occurrences(full, "Coverage: "), 1);
  });

  test("findings read display_name.column; phantom rows carry rename candidates", () => {
    assert.ok(full.includes("  alpha.tag  → did you mean tags?"));
    assert.ok(full.includes("  alpha.gone_a\n")); // no candidate, no arrow
    assert.ok(
      full.includes("  alpha.amount  declared text (string) vs warehouse NUMERIC(38,2) (numeric)"),
    );
    assert.ok(full.includes("  beta  (kitchen://models/_beta.yml)"));
  });

  test("per-section top cap collapses the rest into a counted overflow line", () => {
    const capped = renderTtyReport(kitchen, { top: 2 });
    assert.ok(capped.includes("  …and 1 more (see --md)")); // phantom: 3 - 2
    assert.ok(capped.includes("  …and 2 more (see --md)")); // hollow: 4 - 2
    assert.equal(occurrences(capped, "(see --md)"), 2); // 1-finding sections never overflow
    assert.equal(occurrences(full, "(see --md)"), 0); // under the cap: no overflow lines

    // The cap really hides the tail of each section…
    assert.ok(!capped.includes("alpha.tag")); // phantom's 3rd
    assert.ok(!capped.includes("alpha.h3")); // hollow's 3rd
    assert.ok(!capped.includes("alpha.h4")); // hollow's 4th
    // …while the first `top` entries stay listed.
    assert.ok(capped.includes("alpha.gone_a") && capped.includes("alpha.gone_b"));
    assert.ok(capped.includes("alpha.h1") && capped.includes("alpha.h2"));
  });

  test("top equal to the section size lists every finding with no overflow line", () => {
    // hollow (4) is the largest section: top 4 shows everything, nothing overflows.
    const atLargest = renderTtyReport(kitchen, { top: 4 });
    assert.equal(occurrences(atLargest, "(see --md)"), 0);
    for (const target of ["alpha.gone_a", "alpha.gone_b", "alpha.tag", "alpha.h3", "alpha.h4"]) {
      assert.ok(atLargest.includes(target), `missing ${target}`);
    }

    // top 3 sits exactly AT phantom's size (fully shown, no overflow there)
    // while hollow (4) overflows by exactly one.
    const atPhantom = renderTtyReport(kitchen, { top: 3 });
    assert.equal(occurrences(atPhantom, "(see --md)"), 1);
    assert.ok(atPhantom.includes("alpha.tag"));
    assert.ok(atPhantom.includes("  …and 1 more (see --md)"));
    assert.ok(!atPhantom.includes("alpha.h4"));
  });

  test("clean run prints the exact no-drift phrasing plus the not-checked line", () => {
    const out = renderTtyReport(clean, { top: DEFAULT_TOP_PER_SECTION });
    assert.ok(out.includes("No drift found across 1 checked model.\n"));
    assert.ok(
      out.includes(
        "Not checked: 0 built models with no declared docs and 0 warehouse columns with no YAML declaration.\n",
      ),
    );
    assert.ok(lastLine(out).startsWith("Coverage: "));
    assert.ok(!out.includes("Phantom"));
  });
});

describe("renderMarkdownReport", () => {
  const md = renderMarkdownReport(kitchen);

  test("full detail: every finding lands in a table, no display cap", () => {
    for (const target of ["gone_a", "gone_b", "tag", "amount", "h1", "h2", "h3", "h4", "beta"]) {
      assert.ok(md.includes(`\`${target}\``), `missing ${target}`);
    }
    assert.ok(!md.includes("more (see --md)"));
  });

  test("carries project name, both schema versions, both generated_at stamps", () => {
    assert.ok(md.includes("kitchen_sink"));
    assert.ok(md.includes("| `manifest.json` | v12 | 2026-02-01T00:00:00Z |"));
    assert.ok(md.includes("| `catalog.json` | v1 | 2026-02-01T00:05:00Z |"));
  });

  test("one table per kind with headers, in severity order", () => {
    const markers = [
      "## Phantom columns (3)",
      "| Model | Column | Rename candidate | Declared in |",
      "## Models never built (1)",
      "| Model | Relation | Declared in |",
      "| `beta` | `analytics.core.beta` | `kitchen://models/_beta.yml` |",
      "## Type family mismatches (1)",
      "| Model | Column | Declared | Warehouse | Declared in |",
      "## Hollow descriptions (4)",
      "## Coverage",
    ];
    let last = -1;
    for (const marker of markers) {
      const at = md.indexOf(marker);
      assert.ok(at > last, `expected "${marker}" in order, got position ${at} after ${last}`);
      last = at;
    }
  });

  test("footer links docs and sign-up", () => {
    assert.ok(md.includes(DOCS_URL));
    assert.ok(md.includes(SIGNUP_URL));
  });

  test("clean run keeps the exact no-drift phrasing and drops finding sections", () => {
    const out = renderMarkdownReport(clean);
    assert.ok(out.includes("No drift found across 1 checked model."));
    assert.ok(out.includes("Not checked: "));
    assert.ok(!out.includes("## Phantom"));
  });
});

describe("language invariant", () => {
  test('the word "verified" appears in no rendered output', () => {
    for (const report of [kitchen, clean, phantom]) {
      for (const out of [
        renderTtyReport(report, { top: DEFAULT_TOP_PER_SECTION }),
        renderMarkdownReport(report),
      ]) {
        assert.ok(!/verified/i.test(out));
      }
    }
  });
});
