#!/usr/bin/env node
/**
 * Generate a large synthetic manifest.json + catalog.json pair for perf runs.
 *
 * Streams both files (constant memory), deterministic output (no randomness),
 * with drift injected at fixed rates so the engine's finding paths all get
 * exercised:
 *   - every 20th model is absent from the catalog     (model_never_built)
 *   - every 7th model declares one extra ghost column (phantom_column +
 *     rename-candidate search against all actual columns)
 *   - every 31st column's catalog type is a different family (type_family_mismatch)
 *   - every 11th column's declared description is empty (hollow_description)
 * Catalog column names are uppercased to exercise normalization.
 *
 * Output is a perf fixture, NOT a test fixture — never commit the blobs.
 *
 * Usage (runs via tsx so it can import the engine's type-family table):
 *   npm run gen:perf-fixture -- --target-mb 50 --out tmp/perf-50 [--columns 40]
 */
import { createWriteStream, mkdirSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { typeFamily } from "../src/lib/dbt/type-families.js";

function parseArgs(argv) {
  const args = { targetMb: 50, out: "tmp/perf", columns: 40 };
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--target-mb") (args.targetMb = Number(value)), i++;
    else if (flag === "--out") (args.out = String(value)), i++;
    else if (flag === "--columns") (args.columns = Number(value)), i++;
    else {
      console.error(`unknown flag: ${flag}`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(args.targetMb) || args.targetMb <= 0) throw new Error("--target-mb must be > 0");
  if (!Number.isInteger(args.columns) || args.columns <= 0) throw new Error("--columns must be a positive integer");
  return args;
}

const DECLARED_TYPES = ["bigint", "text", "timestamp", "date", "boolean", "numeric(38,2)"];
const CATALOG_TYPES = ["BIGINT", "TEXT", "TIMESTAMP WITHOUT TIME ZONE", "DATE", "BOOLEAN", "NUMERIC(38,2)"];
// Same index order as above but shifted into a different family (for mismatches).
const MISMATCHED_TYPES = ["TEXT", "BIGINT", "DATE", "TIMESTAMP WITHOUT TIME ZONE", "TEXT", "TEXT"];

// The fixture's premise, enforced against the engine's own family table so an
// edit to type-families.ts cannot silently invalidate the injection rates:
// declared[i] and catalog[i] share a known family; mismatched[i] maps to a
// different known one.
if (CATALOG_TYPES.length !== DECLARED_TYPES.length || MISMATCHED_TYPES.length !== DECLARED_TYPES.length) {
  throw new Error("DECLARED_TYPES, CATALOG_TYPES, and MISMATCHED_TYPES must be index-aligned");
}
for (let i = 0; i < DECLARED_TYPES.length; i++) {
  const declared = typeFamily(DECLARED_TYPES[i]);
  const mismatched = typeFamily(MISMATCHED_TYPES[i]);
  if (declared === null || declared !== typeFamily(CATALOG_TYPES[i]) || mismatched === null || mismatched === declared) {
    throw new Error(
      `type tables drifted from type-families.ts at index ${i}: ` +
        `declared=${DECLARED_TYPES[i]} catalog=${CATALOG_TYPES[i]} mismatched=${MISMATCHED_TYPES[i]}`,
    );
  }
}

// Realistic bulk: manifests are large mostly because of embedded SQL.
const RAW_CODE = "-- synthetic model body\nselect *\nfrom {{ ref('upstream') }}\nwhere loaded_at > '2026-01-01'\n".repeat(24);

async function write(stream, chunk) {
  if (!stream.write(chunk)) await once(stream, "drain");
  return Buffer.byteLength(chunk);
}

function manifestNode(i, columns) {
  const name = `model_${String(i).padStart(6, "0")}`;
  const cols = {};
  for (let c = 0; c < columns; c++) {
    const colName = `col_${c}`;
    cols[colName] = {
      name: colName,
      description: (i + c) % 11 === 0 ? "" : `Synthetic column ${c} of ${name}.`,
      data_type: DECLARED_TYPES[c % DECLARED_TYPES.length],
      meta: {},
      constraints: [],
      tags: [],
    };
  }
  if (i % 7 === 0) {
    cols[`ghost_${i % 5}`] = {
      name: `ghost_${i % 5}`,
      description: "Declared but never materialized.",
      data_type: "text",
      meta: {},
      constraints: [],
      tags: [],
    };
  }
  return {
    unique_id: `model.perf_pkg.${name}`,
    resource_type: "model",
    name,
    package_name: "perf_pkg",
    database: "analytics",
    schema: "synthetic",
    alias: name,
    patch_path: "perf_pkg://models/_models.yml",
    original_file_path: `models/${name}.sql`,
    config: { materialized: i % 13 === 0 ? "view" : "table" },
    columns: cols,
    raw_code: RAW_CODE,
    tags: [],
    depends_on: { nodes: i > 0 ? [`model.perf_pkg.model_${String(i - 1).padStart(6, "0")}`] : [] },
  };
}

function catalogNode(i, columns) {
  const name = `model_${String(i).padStart(6, "0")}`;
  const cols = {};
  for (let c = 0; c < columns; c++) {
    const colName = `COL_${c}`;
    const type =
      (i + c) % 31 === 0 ? MISMATCHED_TYPES[c % MISMATCHED_TYPES.length] : CATALOG_TYPES[c % CATALOG_TYPES.length];
    cols[colName] = { type, index: c + 1, name: colName, comment: null };
  }
  // A catalog-only column (undocumented in YAML) on every 3rd model.
  if (i % 3 === 0) {
    cols.EXTRA_UNDOCUMENTED = { type: "TEXT", index: columns + 1, name: "EXTRA_UNDOCUMENTED", comment: null };
  }
  return {
    metadata: { type: "BASE TABLE", schema: "synthetic", name, database: "analytics", comment: null, owner: "perf" },
    columns: cols,
  };
}

async function main() {
  const { targetMb, out, columns } = parseArgs(process.argv);
  const targetBytes = targetMb * 1024 * 1024;
  mkdirSync(out, { recursive: true });
  const manifestPath = join(out, "manifest.json");
  const catalogPath = join(out, "catalog.json");
  const manifest = createWriteStream(manifestPath);
  const catalog = createWriteStream(catalogPath);

  const metadata = (artifact) =>
    JSON.stringify({
      dbt_schema_version: `https://schemas.getdbt.com/dbt/${artifact}/v${artifact === "manifest" ? 12 : 1}.json`,
      dbt_version: "1.10.0",
      generated_at: "2026-01-01T00:00:00.000000Z",
      ...(artifact === "manifest" ? { project_name: "perf_synthetic" } : {}),
    });

  let manifestBytes = await write(manifest, `{"metadata":${metadata("manifest")},"nodes":{`);
  await write(catalog, `{"metadata":${metadata("catalog")},"nodes":{`);

  let models = 0;
  let inCatalog = 0;
  // Leave room for the closing braces; the last node may overshoot slightly.
  while (manifestBytes < targetBytes - 64) {
    const i = models++;
    const uid = JSON.stringify(`model.perf_pkg.model_${String(i).padStart(6, "0")}`);
    // every 20th model is "never built"
    let catalogChunk = null;
    if (i % 20 !== 0) {
      catalogChunk = `${inCatalog > 0 ? "," : ""}${uid}:${JSON.stringify(catalogNode(i, columns))}`;
      inCatalog++;
    }
    // The two streams are independent — overlap their backpressure waits.
    const [written] = await Promise.all([
      write(manifest, `${i > 0 ? "," : ""}${uid}:${JSON.stringify(manifestNode(i, columns))}`),
      catalogChunk === null ? 0 : write(catalog, catalogChunk),
    ]);
    manifestBytes += written;
  }

  const [tailWritten] = await Promise.all([
    write(manifest, `},"sources":{},"macros":{},"disabled":{}}`),
    write(catalog, `},"sources":{},"errors":null}`),
  ]);
  manifestBytes += tailWritten;
  await Promise.all([
    new Promise((res, rej) => manifest.end((e) => (e ? rej(e) : res()))),
    new Promise((res, rej) => catalog.end((e) => (e ? rej(e) : res()))),
  ]);

  console.log(
    JSON.stringify(
      { models, in_catalog: inCatalog, columns_per_model: columns, manifest: manifestPath, manifest_mb: +(manifestBytes / 1048576).toFixed(1), catalog: catalogPath },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
