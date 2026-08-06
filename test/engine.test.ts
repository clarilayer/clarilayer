import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeDrift, normalizeColumnName } from "../src/lib/dbt/engine.js";
import {
  FINDING_KIND_SEVERITY_ORDER,
  parseDbtSchemaVersion,
  type DbtCatalog,
  type DbtManifest,
} from "../src/lib/dbt/types.js";

const FIXTURES = fileURLToPath(new URL("./fixtures", import.meta.url));

function fixture(name: string): { manifest: DbtManifest; catalog: DbtCatalog } {
  return {
    manifest: JSON.parse(readFileSync(join(FIXTURES, name, "manifest.json"), "utf8")),
    catalog: JSON.parse(readFileSync(join(FIXTURES, name, "catalog.json"), "utf8")),
  };
}

describe("severity order contract", () => {
  test("is exactly the documented order (renderers and exit codes depend on it)", () => {
    assert.deepEqual(FINDING_KIND_SEVERITY_ORDER, [
      "phantom_column",
      "model_never_built",
      "type_family_mismatch",
      "hollow_description",
    ]);
  });
});

describe("parseDbtSchemaVersion", () => {
  test("parses the trailing /{artifact}/v{N}.json segment", () => {
    assert.equal(parseDbtSchemaVersion("https://schemas.getdbt.com/dbt/manifest/v12.json", "manifest"), 12);
    assert.equal(parseDbtSchemaVersion("https://schemas.getdbt.com/dbt/catalog/v1.json", "catalog"), 1);
  });

  test("rejects the wrong artifact and unparseable strings", () => {
    assert.equal(parseDbtSchemaVersion("https://schemas.getdbt.com/dbt/catalog/v1.json", "manifest"), null);
    assert.equal(parseDbtSchemaVersion("not a schema url", "manifest"), null);
    assert.equal(parseDbtSchemaVersion(null, "manifest"), null);
  });
});

describe("normalizeColumnName", () => {
  test("trims, strips surrounding quotes/backticks, lowercases", () => {
    assert.equal(normalizeColumnName("  User_ID  "), "user_id");
    assert.equal(normalizeColumnName('"Order_Total"'), "order_total");
    assert.equal(normalizeColumnName("`created_at`"), "created_at");
    assert.equal(normalizeColumnName('" spaced "'), "spaced");
    assert.equal(normalizeColumnName("plain"), "plain");
  });
});

describe("phantom_column", () => {
  const report = analyzeDrift(fixture("phantom-column").manifest, fixture("phantom-column").catalog);

  test("flags declared columns absent from the warehouse — and only those", () => {
    assert.deepEqual(
      report.findings.map((f) => [f.kind, f.column]),
      [
        ["phantom_column", "customer_email"],
        ["phantom_column", "tag"],
      ],
    );
  });

  test("matching is case- and quote-normalized on both sides", () => {
    // "id" and "\"quoted_col\"" matched uppercase catalog columns, so no findings.
    const flagged = report.findings.map((f) => f.column);
    assert.ok(!flagged.includes("id"));
    assert.ok(!flagged.includes('"quoted_col"'));
  });

  test("carries a rename candidate (original warehouse spelling) when one is close", () => {
    const tag = report.findings.find((f) => f.column === "tag");
    assert.ok(tag !== undefined && tag.kind === "phantom_column");
    assert.equal(tag.closest_actual, "TAGS");
  });

  test("carries null when nothing is close enough to be a rename", () => {
    const email = report.findings.find((f) => f.column === "customer_email");
    assert.ok(email !== undefined && email.kind === "phantom_column");
    assert.equal(email.closest_actual, null);
  });

  test("every finding carries the full identity contract", () => {
    const tag = report.findings.find((f) => f.column === "tag");
    assert.ok(tag);
    assert.equal(tag.model_unique_id, "model.fixture_phantom.tickets");
    assert.equal(tag.package_name, "fixture_phantom");
    assert.equal(tag.database, "analytics");
    assert.equal(tag.schema, "core");
    assert.equal(tag.alias, "tickets");
    assert.equal(tag.model, "tickets");
    assert.equal(tag.display_name, "tickets");
    assert.equal(tag.yaml_path, "fixture_phantom://models/core/_core__models.yml");
  });

  test("coverage counts actual/declared/undocumented columns", () => {
    assert.deepEqual(report.coverage.columns, { actual: 3, declared: 4, undocumented: 1 });
    assert.equal(report.coverage.hollow, 0);
  });
});

describe("model_never_built", () => {
  const report = analyzeDrift(
    fixture("model-never-built").manifest,
    fixture("model-never-built").catalog,
  );

  test("flags a non-ephemeral model missing from the catalog, at model level", () => {
    assert.equal(report.findings.length, 1);
    const finding = report.findings[0];
    assert.equal(finding.kind, "model_never_built");
    assert.equal(finding.model, "never_built");
    assert.equal(finding.column, null);
    assert.equal(finding.alias, "never_built_alias");
  });

  test("ephemeral models and non-model nodes are never flagged", () => {
    assert.ok(!report.findings.some((f) => f.model === "eph_model"));
    assert.ok(!report.findings.some((f) => f.model === "country_codes"));
  });

  test("coverage separates total/ephemeral/built/documented", () => {
    assert.deepEqual(report.coverage.models, { total: 3, ephemeral: 1, built: 1, documented: 1 });
  });

  test("accepts manifest schema v11", () => {
    assert.equal(report.manifest_schema_version, 11);
  });
});

describe("type_family_mismatch", () => {
  const report = analyzeDrift(fixture("type-mismatch").manifest, fixture("type-mismatch").catalog);

  test("flags only known, differing families — with both raw types and families", () => {
    assert.equal(report.findings.length, 1);
    const finding = report.findings[0];
    assert.ok(finding.kind === "type_family_mismatch");
    assert.equal(finding.column, "amount");
    assert.equal(finding.declared_type, "varchar(16)");
    assert.equal(finding.actual_type, "NUMERIC(38,2)");
    assert.equal(finding.declared_family, "string");
    assert.equal(finding.actual_family, "numeric");
  });

  test("same family after parameter stripping is not flagged", () => {
    const flagged = report.findings.map((f) => f.column);
    assert.ok(!flagged.includes("created_at")); // timestamp_ntz vs TIMESTAMP WITH TIME ZONE
    assert.ok(!flagged.includes("flags")); // array<string> vs ARRAY<STRING>
  });

  test("an unknown family on either side is never flagged", () => {
    const flagged = report.findings.map((f) => f.column);
    assert.ok(!flagged.includes("payload")); // declared type unknown
    assert.ok(!flagged.includes("note")); // warehouse type unknown
  });

  test("accepts manifest schema v10", () => {
    assert.equal(report.manifest_schema_version, 10);
  });
});

describe("hollow_description", () => {
  const report = analyzeDrift(
    fixture("hollow-description").manifest,
    fixture("hollow-description").catalog,
  );

  test("flags empty and whitespace-only descriptions, not real ones", () => {
    assert.deepEqual(
      report.findings.map((f) => [f.kind, f.column]),
      [
        ["hollow_description", "full_name"],
        ["hollow_description", "id"],
      ],
    );
  });

  test("hollow count is coverage metadata too; undocumented is a stat, not a finding", () => {
    assert.equal(report.coverage.hollow, 2);
    assert.equal(report.coverage.columns.undocumented, 1); // undocumented_extra
    assert.ok(!report.findings.some((f) => f.column === "undocumented_extra"));
  });
});

describe("display_name disambiguation", () => {
  const report = analyzeDrift(
    fixture("duplicate-model-names").manifest,
    fixture("duplicate-model-names").catalog,
  );

  test("duplicate model names across packages get package-qualified display names", () => {
    const byUniqueId = new Map(report.findings.map((f) => [f.model_unique_id, f.display_name]));
    assert.equal(byUniqueId.get("model.shop.customers"), "shop.customers");
    assert.equal(byUniqueId.get("model.vendor_pkg.customers"), "vendor_pkg.customers");
  });

  test("unambiguous model names stay bare", () => {
    const orders = report.findings.find((f) => f.model_unique_id === "model.shop.orders");
    assert.ok(orders);
    assert.equal(orders.display_name, "orders");
  });
});

describe("clean project", () => {
  const report = analyzeDrift(fixture("clean").manifest, fixture("clean").catalog);

  test("zero findings, full coverage, report metadata populated", () => {
    assert.deepEqual(report.findings, []);
    assert.deepEqual(report.coverage.models, { total: 1, ephemeral: 0, built: 1, documented: 1 });
    assert.deepEqual(report.coverage.columns, { actual: 2, declared: 2, undocumented: 0 });
    assert.equal(report.coverage.hollow, 0);
    assert.equal(report.project_name, "fixture_clean");
    assert.equal(report.manifest_schema_version, 12);
    assert.equal(report.catalog_schema_version, 1);
    assert.equal(report.manifest_generated_at, "2026-01-01T00:00:00.000000Z");
    assert.equal(report.catalog_generated_at, "2026-01-01T00:05:00.000000Z");
  });
});

describe("report ordering", () => {
  test("findings sort by severity order, then display_name, then column", () => {
    const manifest: DbtManifest = {
      metadata: {
        dbt_schema_version: "https://schemas.getdbt.com/dbt/manifest/v12.json",
        project_name: "synthetic",
        generated_at: "2026-01-01T00:00:00Z",
      },
      nodes: {
        "model.p.alpha": {
          resource_type: "model",
          name: "alpha",
          package_name: "p",
          database: "db",
          schema: "s",
          alias: "alpha",
          patch_path: "p://models/_models.yml",
          original_file_path: "models/alpha.sql",
          config: { materialized: "table" },
          columns: {
            ghost: { name: "ghost", description: "Declared only.", data_type: null },
            amount: { name: "amount", description: "", data_type: "text" },
          },
        },
        "model.p.beta": {
          resource_type: "model",
          name: "beta",
          package_name: "p",
          database: "db",
          schema: "s",
          alias: "beta",
          patch_path: null,
          original_file_path: "models/beta.sql",
          config: { materialized: "table" },
          columns: {},
        },
      },
    };
    const catalog: DbtCatalog = {
      metadata: {
        dbt_schema_version: "https://schemas.getdbt.com/dbt/catalog/v1.json",
        generated_at: "2026-01-01T00:05:00Z",
      },
      nodes: {
        "model.p.alpha": {
          columns: { amount: { type: "numeric", name: "amount" } },
        },
      },
    };

    const report = analyzeDrift(manifest, catalog);
    assert.deepEqual(
      report.findings.map((f) => f.kind),
      ["phantom_column", "model_never_built", "type_family_mismatch", "hollow_description"],
    );
  });
});
