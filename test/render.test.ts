import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DOCS_URL, SIGNUP_URL } from "../src/lib/constants.js";
import { analyzeDrift } from "../src/lib/dbt/engine.js";
import { renderMarkdownReport } from "../src/lib/dbt/render-md.js";
import { DEFAULT_TOP_PER_SECTION, renderTtyReport } from "../src/lib/dbt/render-tty.js";
import type { DbtCatalog, DbtManifest, DriftReport } from "../src/lib/dbt/types.js";
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

/** The kitchen-sink report with one artifact stamp moved, so the same
 * findings can be rendered fresh, manifest-stale, and catalog-stale. */
function skewed(direction: "manifest_newer" | "catalog_newer"): DriftReport {
  const manifest: DbtManifest = {
    ...kitchenManifest,
    metadata: {
      ...kitchenManifest.metadata,
      generated_at:
        direction === "manifest_newer" ? "2026-02-02T06:00:00Z" : "2026-02-01T00:00:00Z",
    },
  };
  const catalog: DbtCatalog = {
    ...kitchenCatalog,
    metadata: {
      ...kitchenCatalog.metadata,
      generated_at:
        direction === "manifest_newer" ? "2026-02-01T00:00:00Z" : "2026-02-02T06:00:00Z",
    },
  };
  return analyzeDrift(manifest, catalog);
}

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
      "9 drift findings: 3 phantom columns, 1 model missing from the catalog, 1 type family mismatch, 4 hollow descriptions",
      "Phantom columns (3)",
      "Missing from the catalog (1)",
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
      "## Missing from the catalog (1)",
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

describe('the "missing from the catalog" label', () => {
  test("no rendered surface states the unobserved cause", () => {
    for (const out of [
      renderTtyReport(kitchen, { top: DEFAULT_TOP_PER_SECTION, saveHint: true }),
      renderMarkdownReport(kitchen),
    ]) {
      assert.ok(/Missing from the catalog/.test(out));
      assert.ok(!/never built/i.test(out), "the cause is an inference, not an observation");
    }
  });

  test("the headline count-noun reads the same way", () => {
    const out = renderTtyReport(kitchen, { top: DEFAULT_TOP_PER_SECTION });
    assert.ok(out.includes("1 model missing from the catalog"));
  });

  test("the description says exactly what was compared", () => {
    const tty = renderTtyReport(kitchen, { top: DEFAULT_TOP_PER_SECTION });
    assert.ok(
      tty.includes(
        "Missing from the catalog (1) — a non-ephemeral model present in the manifest but absent from the warehouse catalog",
      ),
    );
    assert.ok(
      renderMarkdownReport(kitchen).includes(
        "A non-ephemeral model present in the manifest but absent from the warehouse catalog.",
      ),
    );
  });
});

describe("artifact-skew warning", () => {
  const manifestNewer = renderTtyReport(skewed("manifest_newer"), {
    top: DEFAULT_TOP_PER_SECTION,
  });
  const catalogNewer = renderTtyReport(skewed("catalog_newer"), {
    top: DEFAULT_TOP_PER_SECTION,
  });

  test("fresh artifacts (5 minutes apart) print no warning at all", () => {
    for (const out of [
      renderTtyReport(kitchen, { top: DEFAULT_TOP_PER_SECTION }),
      renderMarkdownReport(kitchen),
      renderTtyReport(clean, { top: DEFAULT_TOP_PER_SECTION }),
      renderMarkdownReport(clean),
    ]) {
      assert.ok(!out.includes("Artifact skew"), out.slice(0, 80));
    }
  });

  test("the warning sits ABOVE the headline and every finding it qualifies", () => {
    const skewAt = manifestNewer.indexOf("Artifact skew:");
    assert.ok(skewAt > 0);
    assert.ok(skewAt < manifestNewer.indexOf("9 drift findings"));
    assert.ok(skewAt < manifestNewer.indexOf("Phantom columns (3)"));
    // Markdown places it above everything too, as a blockquote.
    const md = renderMarkdownReport(skewed("manifest_newer"));
    const mdSkewAt = md.indexOf("Artifact skew:");
    assert.ok(md.includes("> **Artifact skew:"));
    assert.ok(mdSkewAt > 0 && mdSkewAt < md.indexOf("9 drift findings"));
    assert.ok(mdSkewAt < md.indexOf("## Phantom columns"));
  });

  test("manifest-newer names the dangerous direction and the fix", () => {
    assert.ok(manifestNewer.includes("manifest.json is 1 day 6 hours NEWER than catalog.json."));
    assert.ok(manifestNewer.includes("The catalog predates your docs"));
    assert.ok(manifestNewer.includes("phantom columns or as missing from the catalog"));
    assert.ok(manifestNewer.includes("Re-run `dbt docs generate`"));
    // It must NOT be described as under-reporting — that is the other case.
    assert.ok(!manifestNewer.includes("under-reported"));
  });

  test("catalog-newer gets its own, milder wording — not the same sentence", () => {
    assert.ok(catalogNewer.includes("catalog.json is 1 day 6 hours newer than manifest.json."));
    assert.ok(catalogNewer.includes("drift below may be under-reported"));
    assert.ok(!catalogNewer.includes("The catalog predates your docs"));
    assert.ok(!catalogNewer.includes("NEWER"));
  });

  test("the warning changes no finding, count, or coverage line", () => {
    // Everything from the headline down must be byte-identical to the fresh
    // render: the warning qualifies the report, it does not alter it.
    const fromHeadline = (out: string): string => out.slice(out.indexOf("9 drift findings"));
    const fresh = renderTtyReport(kitchen, { top: DEFAULT_TOP_PER_SECTION });
    assert.equal(fromHeadline(manifestNewer), fromHeadline(fresh));
    assert.equal(fromHeadline(catalogNewer), fromHeadline(fresh));
  });
});

describe("save-preview next step", () => {
  test("off by default, so the coverage line stays last", () => {
    const out = renderTtyReport(kitchen, { top: DEFAULT_TOP_PER_SECTION });
    assert.ok(lastLine(out).startsWith("Coverage: "));
    assert.ok(!out.includes("--dry-run"));
  });

  test("when asked for, it closes the report and points at the preview", () => {
    const out = renderTtyReport(kitchen, { top: DEFAULT_TOP_PER_SECTION, saveHint: true });
    assert.ok(out.includes("npx clarilayer dbt-check --save --dry-run"));
    assert.ok(out.includes("no key, no network"));
    assert.ok(out.includes("Context Inbox"));
    assert.ok(lastLine(out).includes("for you to review."));
    // Coverage is still the last line of the report proper: two CTA lines and
    // one separating blank follow it, and nothing else.
    const lines = out.trimEnd().split("\n");
    assert.deepEqual(lines.slice(-3).map((l) => l === ""), [true, false, false]);
    assert.ok(lines[lines.length - 4].startsWith("Coverage: "));
  });

  test("says only what saving does today — no tracking or resolution lifecycle", () => {
    const out = renderTtyReport(kitchen, { top: DEFAULT_TOP_PER_SECTION, saveHint: true });
    for (const overclaim of [/track/i, /monitor/i, /resolve/i, /re-?check(ed|s)? for you/i, /fixed/i]) {
      assert.ok(!overclaim.test(out), `${overclaim} must not appear`);
    }
  });

  test("the markdown report never carries it (it is terminal copy)", () => {
    assert.ok(!renderMarkdownReport(kitchen).includes("--save --dry-run"));
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
