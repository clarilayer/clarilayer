import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { analyzeDrift, normalizeColumnName } from "../src/lib/dbt/engine.js";
import {
  FINDING_KIND_SEVERITY_ORDER,
  parseDbtSchemaVersion,
  type DbtCatalog,
  type DbtManifest,
} from "../src/lib/dbt/types.js";
import { fixture } from "./helpers.js";

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

describe("analyzeDrift schema-version hard-fail", () => {
  // The pure engine enforces the same supported-version matrix as the file
  // loader: a parseable-but-unsupported version is refused, not analyzed.
  test("rejects an unsupported (older) manifest schema version", () => {
    const { manifest, catalog } = fixture("unsupported-version"); // manifest v9
    assert.throws(
      () => analyzeDrift(manifest, catalog),
      (err: unknown) =>
        err instanceof Error &&
        err.message.includes("manifest.json uses v9") &&
        err.message.includes("v10, v11, v12"),
    );
  });

  test("rejects an unsupported catalog schema version", () => {
    const { manifest, catalog } = fixture("clean");
    catalog.metadata.dbt_schema_version = "https://schemas.getdbt.com/dbt/catalog/v2.json";
    assert.throws(
      () => analyzeDrift(manifest, catalog),
      (err: unknown) =>
        err instanceof Error &&
        err.message.includes("catalog.json uses v2") &&
        err.message.includes("v1"),
    );
  });

  test("rejects a missing or unparseable schema version", () => {
    const { manifest, catalog } = fixture("clean");
    delete (manifest.metadata as Record<string, unknown>).dbt_schema_version;
    assert.throws(() => analyzeDrift(manifest, catalog), /unrecognized schema version/);
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
  const { manifest, catalog } = fixture("phantom-column");
  const report = analyzeDrift(manifest, catalog);

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

  test("similarity exactly at the 0.6 threshold is accepted (inclusive >=)", () => {
    // levenshtein("abcde", "abcxy") = 2 over maxLen 5, and 1 - 2/5 is
    // bit-exactly the double 0.6 (1 - 2/5 === 0.6), so this candidate sits
    // precisely ON the threshold: a strict > would drop the suggestion.
    const atThreshold = analyzeDrift(
      {
        metadata: {
          dbt_schema_version: "https://schemas.getdbt.com/dbt/manifest/v12.json",
          project_name: "threshold",
        },
        nodes: {
          "model.p.m": {
            resource_type: "model",
            name: "m",
            package_name: "p",
            database: "db",
            schema: "s",
            alias: "m",
            config: { materialized: "table" },
            columns: { abcde: { name: "abcde", description: "Renamed.", data_type: null } },
          },
        },
      },
      {
        metadata: { dbt_schema_version: "https://schemas.getdbt.com/dbt/catalog/v1.json" },
        nodes: { "model.p.m": { columns: { abcxy: { type: "text", name: "abcxy" } } } },
      },
    );
    const finding = atThreshold.findings.find((f) => f.column === "abcde");
    assert.ok(finding !== undefined && finding.kind === "phantom_column");
    assert.equal(finding.closest_actual, "abcxy");
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
  const { manifest, catalog } = fixture("model-never-built");
  const report = analyzeDrift(manifest, catalog);

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
  const { manifest, catalog } = fixture("type-mismatch");
  const report = analyzeDrift(manifest, catalog);

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
  const { manifest, catalog } = fixture("hollow-description");
  const report = analyzeDrift(manifest, catalog);

  test("flags empty and whitespace-only descriptions, not real ones", () => {
    const hollow = report.findings.filter((f) => f.kind === "hollow_description");
    assert.deepEqual(
      hollow.map((f) => [f.model, f.column]),
      [
        ["customers", "full_name"],
        ["customers", "id"],
        ["eph_helper", "note"],
        ["unbuilt", "amount"],
      ],
    );
  });

  test("fixture yields exactly 4 hollow findings plus unbuilt's model_never_built — no other kinds", () => {
    const kindCounts: Record<string, number> = {};
    for (const f of report.findings) kindCounts[f.kind] = (kindCounts[f.kind] ?? 0) + 1;
    assert.deepEqual(kindCounts, { hollow_description: 4, model_never_built: 1 });
  });

  test("fires on ephemeral and never-built models too — it is a YAML-doc finding, not a warehouse one", () => {
    // eph_helper is ephemeral (never materializes) and unbuilt is absent from
    // the catalog; their empty descriptions are still hollow.
    assert.ok(
      report.findings.some((f) => f.kind === "hollow_description" && f.model === "eph_helper"),
    );
    assert.ok(
      report.findings.some((f) => f.kind === "hollow_description" && f.model === "unbuilt"),
    );
    // The warehouse-dependent kinds keep their own rules: unbuilt is still
    // model_never_built, and the ephemeral model never is.
    assert.deepEqual(
      report.findings.filter((f) => f.kind === "model_never_built").map((f) => f.model),
      ["unbuilt"],
    );
  });

  test("hollow count is coverage metadata too; undocumented is a stat, not a finding", () => {
    assert.equal(report.coverage.hollow, 4);
    // declared spans all models (3 on customers + 1 ephemeral + 1 unbuilt);
    // actual/undocumented only exist for built models.
    assert.deepEqual(report.coverage.columns, { actual: 4, declared: 5, undocumented: 1 });
    assert.ok(!report.findings.some((f) => f.column === "undocumented_extra"));
  });
});

describe("normalized-name collisions (first-wins policy)", () => {
  // Two spellings collapsing to one normalized name are rare but real (e.g.
  // Snowflake permits quoted, case-distinct columns). Policy on BOTH sides:
  // the first spelling over the byte-sorted original keys wins, and the
  // duplicate is ignored — deterministic, never object-order last-write-wins.
  // Object orders below are deliberately adversarial: the sorted-first winner
  // is never in the object position an unsorted or last-write implementation
  // would pick.
  const manifest: DbtManifest = {
    metadata: {
      dbt_schema_version: "https://schemas.getdbt.com/dbt/manifest/v12.json",
      project_name: "collisions",
    },
    nodes: {
      "model.p.dupes": {
        resource_type: "model",
        name: "dupes",
        package_name: "p",
        database: "db",
        schema: "s",
        alias: "dupes",
        patch_path: "p://models/_models.yml",
        original_file_path: "models/dupes.sql",
        config: { materialized: "table" },
        columns: {
          // '"ID"' sorts first ('"' = 0x22 < 'i'), so it wins over "id" even
          // though "id" comes first in object order.
          id: { name: "id", description: "", data_type: null },
          '"ID"': { name: '"ID"', description: "Primary key.", data_type: "varchar" },
          tags: { name: "tags", description: "Renamed in the warehouse.", data_type: null },
        },
      },
    },
  };
  const catalog: DbtCatalog = {
    metadata: { dbt_schema_version: "https://schemas.getdbt.com/dbt/catalog/v1.json" },
    nodes: {
      "model.p.dupes": {
        columns: {
          '"ID"': { type: "TEXT", name: '"ID"' },
          ID: { type: "NUMBER", name: "ID" },
          TAG: { type: "NUMBER", name: "TAG" },
          '"TAG"': { type: "TEXT", name: '"TAG"' },
        },
      },
    },
  };
  const report = analyzeDrift(manifest, catalog);

  test("declared side: only the first-sorted spelling is checked and counted", () => {
    // The winning '"ID"' has a description; the empty-description "id"
    // duplicate is ignored, so no hollow finding fires.
    assert.ok(!report.findings.some((f) => f.kind === "hollow_description"));
    // One count per normalized name: {id, tags}.
    assert.equal(report.coverage.columns.declared, 2);
  });

  test("actual side: matching uses the first-sorted spelling's type and original name", () => {
    // Declared '"ID"' (varchar → string) is compared against the winning
    // '"ID"' (TEXT → string), not the losing ID (NUMBER → numeric).
    assert.ok(!report.findings.some((f) => f.kind === "type_family_mismatch"));
    // The phantom "tags" rename suggestion carries the winning original
    // spelling of the tag column.
    const tags = report.findings.find((f) => f.column === "tags");
    assert.ok(tags !== undefined && tags.kind === "phantom_column");
    assert.equal(tags.closest_actual, '"TAG"');
    // And the deduped actual side counts one column per normalized name.
    assert.equal(report.coverage.columns.actual, 2);
  });
});

describe("display_name disambiguation", () => {
  const { manifest, catalog } = fixture("duplicate-model-names");
  const report = analyzeDrift(manifest, catalog);

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
  const { manifest, catalog } = fixture("clean");
  const report = analyzeDrift(manifest, catalog);

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
