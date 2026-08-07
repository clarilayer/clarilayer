/**
 * `--save` payload mapping and transport, all without a network:
 *   - buildSaveItems: severity-then-object selection, the 24+1 cap,
 *     display_name usage, exact body shape, size pre-checks (the mandatory
 *     summary included);
 *   - buildProposeBatchRequest: the one JSON-RPC body shape;
 *   - sendProposeBatch: mocked fetch pinning all three headers, the
 *     redirect:"error" pin, the single-call contract, strict response
 *     matching (jsonrpc 2.0 + our id), and every terminal failure path
 *     (401 with a FIXED local message — remote text never printed — plus
 *     413, 429, JSON-RPC error, network, timeout), with the bearer key
 *     scrubbed from every failure message;
 *   - renderSaveResultLines: the review-language contract, partial
 *     acceptance (backlog_full) reporting, and key-scrubbing of the
 *     server-derived success-path strings;
 *   - runDbtCheck in-process: each failure path exits 2 with the message on
 *     stderr, the stdout stream contract intact, and exactly one fetch call.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { join } from "node:path";
import { runDbtCheck, type DbtCheckOptions } from "../src/commands/dbt-check.js";
import { analyzeDrift, computeArtifactSkew } from "../src/lib/dbt/engine.js";
import type {
  DbtCatalog,
  DbtManifest,
  DriftReport,
  ManifestColumn,
  ManifestNode,
} from "../src/lib/dbt/types.js";
import {
  JSONRPC_REQUEST_ID,
  MAX_ITEM_BYTES,
  MAX_ITEMS_PER_CALL,
  MAX_SAVE_FINDING_OBJECTS,
  MAX_TOTAL_ITEM_BYTES,
  buildProposeBatchRequest,
  buildSaveItems,
  keyRedactor,
  renderSaveResultLines,
  sendProposeBatch,
  type BuildSaveItemsOptions,
  type ProposalItem,
  type ProposeBatchResult,
} from "../src/lib/save.js";
import { FIXTURES } from "./helpers.js";

const NOW = new Date("2026-08-06T12:34:56Z");
const CLI_VERSION = "9.9.9";
const RATIONALE = "Found by clarilayer dbt-check 9.9.9 on 2026-08-06";
const KEY = "cl_test_1234567890";

function makeManifest(nodes: Record<string, ManifestNode>): DbtManifest {
  return {
    metadata: {
      dbt_schema_version: "https://schemas.getdbt.com/dbt/manifest/v12.json",
      project_name: "fixture_save",
    },
    nodes,
  };
}

function makeCatalog(nodes: DbtCatalog["nodes"]): DbtCatalog {
  return {
    metadata: { dbt_schema_version: "https://schemas.getdbt.com/dbt/catalog/v1.json" },
    nodes,
  };
}

function model(
  pkg: string,
  name: string,
  columns: Record<string, ManifestColumn>,
): ManifestNode {
  return {
    resource_type: "model",
    name,
    package_name: pkg,
    database: "analytics",
    schema: "core",
    alias: name,
    patch_path: `${pkg}://models/_models.yml`,
    config: { materialized: "table" },
    columns,
  };
}

/**
 * One of each stageable kind plus one hollow description:
 *   orders.tag       phantom (closest actual "tags")
 *   ghost            model_never_built
 *   orders.amount    type_family_mismatch (varchar vs NUMERIC)
 *   orders.blank     hollow_description (never staged)
 */
function mixedReport() {
  const manifest = makeManifest({
    "model.shop.orders": model("shop", "orders", {
      tag: { name: "tag", description: "Ticket tag." },
      amount: { name: "amount", description: "Amount.", data_type: "varchar(16)" },
      blank: { name: "blank", description: "" },
    }),
    "model.shop.ghost": model("shop", "ghost", {
      x: { name: "x", description: "Documented but never built." },
    }),
  });
  const catalog = makeCatalog({
    "model.shop.orders": {
      columns: {
        tags: { type: "VARCHAR", name: "tags" },
        amount: { type: "NUMERIC(38,2)", name: "amount" },
        blank: { type: "VARCHAR", name: "blank" },
      },
    },
  });
  return analyzeDrift(manifest, catalog);
}

/** buildSaveItems under the suite's fixed clock and version; extras override. */
function stage(report: DriftReport, extra: Partial<BuildSaveItemsOptions> = {}) {
  return buildSaveItems(report, { cliVersion: CLI_VERSION, now: NOW, ...extra });
}

/** mixedReport() with the artifact stamps moved 30 hours apart. */
function skewedMixedReport(direction: "manifest_newer" | "catalog_newer"): DriftReport {
  const report = mixedReport();
  const [manifestAt, catalogAt] =
    direction === "manifest_newer"
      ? ["2026-02-02T06:00:00Z", "2026-02-01T00:00:00Z"]
      : ["2026-02-01T00:00:00Z", "2026-02-02T06:00:00Z"];
  return {
    ...report,
    manifest_generated_at: manifestAt,
    catalog_generated_at: catalogAt,
    artifact_skew: computeArtifactSkew(manifestAt, catalogAt),
  };
}

describe("buildSaveItems payload mapping", () => {
  test("one proposal per finding object in severity order, plus the summary last", () => {
    const report = mixedReport();
    const { items, objectsStaged, objectsTotal, skippedLocally } = stage(report);

    assert.equal(items.length, 4); // 3 finding objects + 1 run summary
    assert.equal(objectsStaged, 3);
    assert.equal(objectsTotal, 3);
    assert.deepEqual(skippedLocally, []);
    assert.deepEqual(
      items.map((i) => i.name),
      ["orders.tag", "ghost", "orders.amount", "dbt drift report — fixture_save"],
    );
    assert.deepEqual(
      items.map((i) => i.type),
      ["schema_note", "schema_note", "schema_note", "note"],
    );
    for (const item of items) {
      assert.equal(item.provenance, "dbt");
      assert.equal(item.rationale, RATIONALE);
      assert.equal(item.body.source_kind, "dbt");
      assert.equal(item.body.source_tool, "clarilayer_dbt_check");
    }
  });

  test("column-level body carries exactly the mapped fields (closest_match only when present)", () => {
    const report = mixedReport();
    const { items } = stage(report);

    const phantom = items[0];
    assert.deepEqual(phantom.body.dbt_check, {
      cli_version: CLI_VERSION,
      finding_kinds: ["phantom_column"],
      model_unique_id: "model.shop.orders",
      package_name: "shop",
      database: "analytics",
      schema: "core",
      alias: "orders",
      model: "orders",
      column: "tag",
      yaml_path: "shop://models/_models.yml",
      manifest_schema_version: 12,
      closest_match: "tags",
      // These fixtures carry no generated_at, so the gap is unknown — and an
      // unknown gap still travels, rather than being omitted and read later
      // as "the artifacts were fine".
      artifact_skew: {
        manifest_generated_at: null,
        catalog_generated_at: null,
        skew_seconds: null,
        stale: false,
      },
    });
    assert.ok(phantom.content.includes('"tags"'), "content names the rename candidate");

    const mismatch = items[2];
    assert.ok(!("closest_match" in mismatch.body.dbt_check));
    assert.deepEqual((mismatch.body.dbt_check as { finding_kinds: string[] }).finding_kinds, [
      "type_family_mismatch",
    ]);
    assert.ok(mismatch.content.includes("varchar(16)"));
    assert.ok(mismatch.content.includes("NUMERIC(38,2)"));
  });

  test("model-level object: name is the display_name and column is null", () => {
    const report = mixedReport();
    const { items } = stage(report);
    const never = items[1];
    assert.equal(never.name, "ghost");
    assert.equal(never.type, "schema_note");
    const body = never.body.dbt_check as { column: string | null; finding_kinds: string[] };
    assert.equal(body.column, null);
    assert.deepEqual(body.finding_kinds, ["model_never_built"]);
  });

  test("hollow descriptions are never staged, but the summary still counts them", () => {
    const report = mixedReport();
    const { items } = stage(report);
    assert.ok(!items.some((i) => i.name === "orders.blank"));
    for (const item of items.slice(0, -1)) {
      const kinds = (item.body.dbt_check as { finding_kinds: string[] }).finding_kinds;
      assert.ok(!kinds.includes("hollow_description"), item.name);
    }
    const summary = items[items.length - 1];
    const summaryBody = summary.body.dbt_check as {
      finding_counts: Record<string, number>;
      objects_staged: number;
      objects_total: number;
    };
    assert.equal(summaryBody.finding_counts.hollow_description, 1);
    assert.equal(summaryBody.finding_counts.phantom_column, 1);
    assert.equal(summaryBody.objects_staged, 3);
    assert.equal(summaryBody.objects_total, 3);
    assert.ok(summary.content.includes("2026-08-06"));
    assert.ok(summary.content.includes("never staged"));
  });

  test("names use display_name, so duplicate model names stay package-qualified", () => {
    const manifest = makeManifest({
      "model.shop.customers": model("shop", "customers", {
        id: { name: "id", description: "pk" },
      }),
      "model.vendor_pkg.customers": model("vendor_pkg", "customers", {
        id: { name: "id", description: "pk" },
      }),
    });
    const catalog = makeCatalog({
      "model.shop.customers": { columns: {} }, // id is phantom here
      "model.vendor_pkg.customers": { columns: { id: { type: "NUMBER", name: "id" } } },
    });
    const report = analyzeDrift(manifest, catalog);
    const { items } = stage(report);
    assert.equal(items[0].name, "shop.customers.id");
  });

  test("caps: default 10 objects, --save-top up to the hard cap of 24 (+1 summary = 25)", () => {
    assert.equal(MAX_SAVE_FINDING_OBJECTS + 1, MAX_ITEMS_PER_CALL);

    const columns: Record<string, ManifestColumn> = {};
    for (let i = 0; i < 30; i++) {
      columns[`col_${String(i).padStart(2, "0")}`] = {
        name: `col_${String(i).padStart(2, "0")}`,
        description: "documented",
      };
    }
    const report = analyzeDrift(
      makeManifest({ "model.shop.wide": model("shop", "wide", columns) }),
      makeCatalog({ "model.shop.wide": { columns: { other: { type: "VARCHAR", name: "other" } } } }),
    );

    const byDefault = stage(report);
    assert.equal(byDefault.items.length, 11); // 10 objects + summary
    assert.equal(byDefault.objectsStaged, 10);
    assert.equal(byDefault.objectsTotal, 30);

    const topped = stage(report, { saveTop: 24 });
    assert.equal(topped.items.length, 25);

    // The pure builder clamps even an over-cap request (the CLI refuses it earlier).
    const over = stage(report, { saveTop: 999 });
    assert.equal(over.items.length, 25);
    assert.equal(over.items[24].type, "note");
  });

  test("a clean report still stages exactly one run-summary note", () => {
    const report = analyzeDrift(
      makeManifest({
        "model.shop.orders": model("shop", "orders", {
          id: { name: "id", description: "pk" },
        }),
      }),
      makeCatalog({ "model.shop.orders": { columns: { id: { type: "NUMBER", name: "id" } } } }),
    );
    const { items, objectsTotal } = stage(report);
    assert.equal(objectsTotal, 0);
    assert.equal(items.length, 1);
    assert.equal(items[0].type, "note");
    assert.ok(items[0].content.includes("No drift found"));
  });

  test("size pre-check: an item over the per-item cap is excluded locally", () => {
    const huge = `h${"x".repeat(40_000)}`; // item bytes > 32KiB via name/body
    const report = analyzeDrift(
      makeManifest({
        "model.shop.orders": model("shop", "orders", {
          tag: { name: "tag", description: "small" },
          [huge]: { name: huge, description: "big" },
        }),
      }),
      makeCatalog({ "model.shop.orders": { columns: {} } }),
    );
    const { items, objectsStaged, skippedLocally } = stage(report);
    assert.equal(skippedLocally.length, 1);
    assert.equal(skippedLocally[0].reason, "local_item_cap");
    assert.equal(objectsStaged, 1);
    assert.deepEqual(
      items.map((i) => i.type),
      ["schema_note", "note"],
    );
    assert.equal(items[0].name, "orders.tag");
    for (const item of items) {
      assert.ok(Buffer.byteLength(JSON.stringify(item), "utf8") <= MAX_ITEM_BYTES);
    }
  });

  test("size pre-check: trailing items are shed until the total fits the per-call budget", () => {
    const columns: Record<string, ManifestColumn> = {};
    for (let i = 0; i < 24; i++) {
      const name = `c${String(i).padStart(2, "0")}${"x".repeat(4000)}`;
      columns[name] = { name, description: "documented" };
    }
    const report = analyzeDrift(
      makeManifest({ "model.shop.wide": model("shop", "wide", columns) }),
      makeCatalog({ "model.shop.wide": { columns: {} } }),
    );
    const { items, objectsStaged, skippedLocally } = stage(report, { saveTop: 24 });
    const total = items.reduce(
      (sum, item) => sum + Buffer.byteLength(JSON.stringify(item), "utf8"),
      0,
    );
    assert.ok(total <= MAX_TOTAL_ITEM_BYTES, `total ${total} must fit`);
    assert.ok(skippedLocally.some((s) => s.reason === "local_total_cap"));
    assert.equal(items.length, objectsStaged + 1);
    assert.equal(items[items.length - 1].type, "note"); // summary always survives
    assert.equal(
      (items[items.length - 1].body.dbt_check as { objects_staged: number }).objects_staged,
      objectsStaged,
    );
  });

  test("size pre-check: the mandatory summary is bounded too — a huge project_name cannot balloon it", () => {
    // Clean report, so the summary is the ONLY item — the one item that can
    // never be shed must still respect both byte caps.
    const manifest = makeManifest({
      "model.shop.orders": model("shop", "orders", {
        id: { name: "id", description: "pk" },
      }),
    });
    manifest.metadata.project_name = "p".repeat(210_000);
    const report = analyzeDrift(
      manifest,
      makeCatalog({ "model.shop.orders": { columns: { id: { type: "NUMBER", name: "id" } } } }),
    );

    const { items } = stage(report);
    assert.equal(items.length, 1);
    let total = 0;
    for (const item of items) {
      const bytes = Buffer.byteLength(JSON.stringify(item), "utf8");
      assert.ok(bytes <= MAX_ITEM_BYTES, `item ${item.name.slice(0, 40)}… is ${bytes} bytes`);
      total += bytes;
    }
    assert.ok(total <= MAX_TOTAL_ITEM_BYTES, `total ${total} must fit`);
    const body = items[0].body.dbt_check as { project_name: string };
    assert.ok(body.project_name.length <= 200, "body project_name is truncated");
    assert.ok(items[0].name.length <= 220, "note name is truncated");
  });

  test("size pre-check: a huge project_name leaves finding items within the caps as well", () => {
    const manifest = makeManifest({
      "model.shop.orders": model("shop", "orders", {
        tag: { name: "tag", description: "Ticket tag." },
      }),
    });
    manifest.metadata.project_name = "q".repeat(210_000);
    const report = analyzeDrift(
      manifest,
      makeCatalog({ "model.shop.orders": { columns: { tags: { type: "VARCHAR", name: "tags" } } } }),
    );

    const { items, objectsStaged } = stage(report);
    assert.equal(objectsStaged, 1); // the phantom column still ships
    let total = 0;
    for (const item of items) {
      const bytes = Buffer.byteLength(JSON.stringify(item), "utf8");
      assert.ok(bytes <= MAX_ITEM_BYTES, `item is ${bytes} bytes`);
      total += bytes;
    }
    assert.ok(total <= MAX_TOTAL_ITEM_BYTES, `total ${total} must fit`);
  });
});

// A saved proposal is read in the Inbox weeks later, alone, with no report
// around it. Whatever qualified a finding on screen has to be IN the item.
describe("staged proposals carry the artifact skew they were computed from", () => {
  const STALE_CAVEAT_MANIFEST_NEWER =
    " Caveat: this run compared artifacts generated 1 day 6 hours apart (manifest.json newer), so findings may be artifacts of an out-of-date catalog rather than current drift.";
  const STALE_CAVEAT_CATALOG_NEWER =
    " Caveat: this run compared artifacts generated 1 day 6 hours apart (catalog.json newer), so the two files describe different moments and drift may be under-reported.";

  test("every item — findings and the run summary — carries the structured skew", () => {
    const report = skewedMixedReport("manifest_newer");
    const { items } = stage(report);
    assert.equal(items.length, 4);
    for (const item of items) {
      assert.deepEqual(
        (item.body.dbt_check as { artifact_skew: unknown }).artifact_skew,
        {
          manifest_generated_at: "2026-02-02T06:00:00Z",
          catalog_generated_at: "2026-02-01T00:00:00Z",
          skew_seconds: 108_000,
          stale: true,
        },
        item.name,
      );
    }
  });

  test("a stale run appends the caveat to every item's content, verbatim", () => {
    const { items } = stage(skewedMixedReport("manifest_newer"));
    for (const item of items) {
      assert.ok(
        item.content.endsWith(STALE_CAVEAT_MANIFEST_NEWER),
        `${item.name} must end with the caveat, got: ${item.content.slice(-180)}`,
      );
    }
  });

  test("the caveat names the direction — the two cases are not one sentence", () => {
    const [manifestNewer] = stage(skewedMixedReport("manifest_newer")).items;
    const [catalogNewer] = stage(skewedMixedReport("catalog_newer")).items;
    assert.ok(manifestNewer.content.endsWith(STALE_CAVEAT_MANIFEST_NEWER));
    assert.ok(catalogNewer.content.endsWith(STALE_CAVEAT_CATALOG_NEWER));
    assert.ok(!manifestNewer.content.includes("under-reported"));
    assert.ok(!catalogNewer.content.includes("out-of-date catalog"));
  });

  test("a fresh run appends nothing — no caveat where there is nothing to caveat", () => {
    for (const item of stage(mixedReport()).items) {
      assert.ok(!item.content.includes("Caveat:"), item.name);
      assert.equal((item.body.dbt_check as { artifact_skew: { stale: boolean } }).artifact_skew.stale, false);
    }
  });

  test("the caveat claims only what the skew data supports", () => {
    for (const direction of ["manifest_newer", "catalog_newer"] as const) {
      for (const item of stage(skewedMixedReport(direction)).items) {
        // It may say a finding MAY be an artifact; it may never say the
        // finding is wrong, invalid, or should be ignored, and it may not
        // reach for a cause the two files cannot establish.
        for (const overclaim of [/\bis wrong\b/i, /\binvalid\b/i, /\bignore\b/i, /\bfalse positive\b/i, /never built/i]) {
          assert.ok(!overclaim.test(item.content), `${overclaim} in ${item.name}`);
        }
      }
    }
  });

  test("the caveat survives a content that would otherwise fill the budget", () => {
    // Reserved space, not appended-then-clipped: a long finding paragraph is
    // a cosmetic loss, a clipped-off caveat is a truthfulness loss.
    const base = mixedReport();
    const huge = { ...base, project_name: "p".repeat(5_000) };
    const report = {
      ...huge,
      manifest_generated_at: "2026-02-02T06:00:00Z",
      catalog_generated_at: "2026-02-01T00:00:00Z",
      artifact_skew: computeArtifactSkew("2026-02-02T06:00:00Z", "2026-02-01T00:00:00Z"),
    };
    for (const item of stage(report).items) {
      assert.ok(item.content.endsWith(STALE_CAVEAT_MANIFEST_NEWER), item.name);
      assert.ok(item.content.length <= 2000, `${item.name} is ${item.content.length} chars`);
    }
  });

  test("the added field and caveat keep every item inside the byte caps", () => {
    const { items } = stage(skewedMixedReport("manifest_newer"), { saveTop: 24 });
    let total = 0;
    for (const item of items) {
      const bytes = Buffer.byteLength(JSON.stringify(item), "utf8");
      assert.ok(bytes <= MAX_ITEM_BYTES, `${item.name} is ${bytes} bytes`);
      total += bytes;
    }
    assert.ok(total <= MAX_TOTAL_ITEM_BYTES, `total ${total} must fit`);
  });
});

describe("buildProposeBatchRequest", () => {
  test("exactly one JSON-RPC tools/call body — never a batch array", () => {
    const report = mixedReport();
    const { items } = stage(report);
    const request = buildProposeBatchRequest(items);
    assert.deepEqual(request, {
      jsonrpc: "2.0",
      id: JSONRPC_REQUEST_ID,
      method: "tools/call",
      params: { name: "propose_batch", arguments: { items } },
    });
  });
});

// ---------------------------------------------------------------------------
// Transport (mocked fetch)
// ---------------------------------------------------------------------------

function mockFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  };
  return { calls, fetchImpl };
}

const OK_STRUCTURED = {
  ok: true,
  proposed_batch: "pb_1",
  results: [{ index: 0, status: "proposed", type: "schema_note", name: "orders.tag", id: "e_1" }],
  summary: { received: 1, proposed: 1, duplicate: 0, dropped: 0 },
  pending_count: 4,
  console_url: "https://clarilayer.com/console/inbox",
};

const OK_RPC = { jsonrpc: "2.0", id: JSONRPC_REQUEST_ID, result: { structuredContent: OK_STRUCTURED } };

function tinyRequest() {
  return buildProposeBatchRequest([
    {
      type: "note",
      name: "dbt drift report — t",
      content: "c",
      body: { source_kind: "dbt", source_tool: "clarilayer_dbt_check", dbt_check: {} },
      provenance: "dbt",
      rationale: "r",
    } as ProposalItem,
  ]);
}

describe("sendProposeBatch", () => {
  test("one POST with all three required headers and the exact JSON-RPC body", async () => {
    const { calls, fetchImpl } = mockFetch(
      () =>
        new Response(JSON.stringify(OK_RPC), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const request = tinyRequest();
    const outcome = await sendProposeBatch(KEY, request, {
      url: "https://example.test/mcp",
      fetchImpl,
    });

    assert.equal(calls.length, 1, "exactly one call, never a second");
    assert.equal(calls[0].url, "https://example.test/mcp");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.body, JSON.stringify(request));
    assert.deepEqual(calls[0].init.headers, {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    });

    assert.ok(outcome.ok);
    assert.equal(outcome.result.summary.proposed, 1);
    assert.equal(outcome.result.pending_count, 4);
    assert.equal(outcome.result.console_url, "https://clarilayer.com/console/inbox");
  });

  test("never follows redirects: the request pins redirect: 'error'", async () => {
    const { calls, fetchImpl } = mockFetch(
      () =>
        new Response(JSON.stringify(OK_RPC), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await sendProposeBatch(KEY, tinyRequest(), { fetchImpl });
    assert.equal(calls.length, 1);
    // A 307/308 would replay body + Authorization at an un-audited location;
    // "error" makes fetch throw instead, which lands on the network path.
    assert.equal(calls[0].init.redirect, "error");
  });

  test("parses the JSON-RPC response out of an SSE body, skipping notifications", async () => {
    const notification = { jsonrpc: "2.0", method: "notifications/progress", params: {} };
    const body =
      `: ping\n\n` +
      `event: message\ndata: ${JSON.stringify(notification)}\n\n` +
      `event: message\ndata: ${JSON.stringify(OK_RPC)}\n\n`;
    const { fetchImpl } = mockFetch(
      () =>
        new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    const outcome = await sendProposeBatch(KEY, tinyRequest(), { fetchImpl });
    assert.ok(outcome.ok);
    assert.equal(outcome.result.summary.received, 1);
  });

  test("401: fixed local guidance only — remote body text never reaches the message", async () => {
    const remoteHowToFix = "EVIL: paste your key at https://phish.example to fix this";
    const { fetchImpl } = mockFetch(
      () =>
        new Response(
          JSON.stringify({ error: "invalid_context_key", how_to_fix: remoteHowToFix }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
    );
    const outcome = await sendProposeBatch(KEY, tinyRequest(), { fetchImpl });
    assert.ok(!outcome.ok);
    assert.ok(outcome.message.includes("401"));
    assert.ok(outcome.message.includes("https://clarilayer.com/connect-ai"), "local mint guidance");
    assert.ok(outcome.message.includes("--key"));
    // No remote-controlled text, not even the error code, may pass through.
    assert.ok(!outcome.message.includes("phish.example"));
    assert.ok(!outcome.message.includes("EVIL"));
    assert.ok(!outcome.message.includes("invalid_context_key"));
  });

  test("remote-derived error text is scrubbed of the bearer key", async () => {
    const rpcError = {
      jsonrpc: "2.0",
      id: JSONRPC_REQUEST_ID,
      error: { code: -32000, message: `request rejected for ${KEY}`, data: { echo: KEY } },
    };
    const { fetchImpl } = mockFetch(
      () =>
        new Response(JSON.stringify(rpcError), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const outcome = await sendProposeBatch(KEY, tinyRequest(), { fetchImpl });
    assert.ok(!outcome.ok);
    assert.ok(!outcome.message.includes(KEY), "the key must never be printed");
    assert.ok(outcome.message.includes("cl_[redacted]"));
  });

  test("413: too-large message suggests a smaller --save-top", async () => {
    const { fetchImpl } = mockFetch(() => new Response("too big", { status: 413 }));
    const outcome = await sendProposeBatch(KEY, tinyRequest(), { fetchImpl });
    assert.ok(!outcome.ok);
    assert.ok(outcome.message.includes("413"));
    assert.ok(outcome.message.includes("--save-top"));
  });

  test("429: Retry-After is surfaced; no retry is attempted", async () => {
    const { calls, fetchImpl } = mockFetch(
      () => new Response("", { status: 429, headers: { "retry-after": "30" } }),
    );
    const outcome = await sendProposeBatch(KEY, tinyRequest(), { fetchImpl });
    assert.ok(!outcome.ok);
    assert.ok(outcome.message.includes("429"));
    assert.ok(outcome.message.includes("30 seconds"));
    assert.equal(calls.length, 1);
  });

  test("JSON-RPC error responses surface message and data, terminal", async () => {
    const rpcError = {
      jsonrpc: "2.0",
      id: JSONRPC_REQUEST_ID,
      error: { code: -32602, message: "items exceed limits", data: { reason: "batch_too_large" } },
    };
    const { fetchImpl } = mockFetch(
      () =>
        new Response(JSON.stringify(rpcError), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const outcome = await sendProposeBatch(KEY, tinyRequest(), { fetchImpl });
    assert.ok(!outcome.ok);
    assert.ok(outcome.message.includes("items exceed limits"));
    assert.ok(outcome.message.includes("batch_too_large"));
  });

  test("network failure: actionable message naming the endpoint, exit path terminal", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const outcome = await sendProposeBatch(KEY, tinyRequest(), {
      url: "https://example.test/mcp",
      fetchImpl,
    });
    assert.ok(!outcome.ok);
    assert.ok(outcome.message.includes("fetch failed"));
    assert.ok(outcome.message.includes("https://example.test/mcp"));
  });

  test("timeout aborts the request and reports it as a timeout", async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      });
    const outcome = await sendProposeBatch(KEY, tinyRequest(), { fetchImpl, timeoutMs: 20 });
    assert.ok(!outcome.ok);
    assert.ok(outcome.message.includes("timed out"));
  });

  test("2xx without a structured propose_batch result is an error, not a success", async () => {
    const { fetchImpl } = mockFetch(
      () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: JSONRPC_REQUEST_ID, result: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const outcome = await sendProposeBatch(KEY, tinyRequest(), { fetchImpl });
    assert.ok(!outcome.ok);
    assert.ok(outcome.message.includes("no structured propose_batch result"));
  });

  test("a response missing the jsonrpc 2.0 marker is rejected, even with a plausible result", async () => {
    const { fetchImpl } = mockFetch(
      () =>
        new Response(
          JSON.stringify({ id: JSONRPC_REQUEST_ID, result: { structuredContent: OK_STRUCTURED } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const outcome = await sendProposeBatch(KEY, tinyRequest(), { fetchImpl });
    assert.ok(!outcome.ok);
    assert.ok(outcome.message.includes("not the JSON-RPC 2.0 response to this request"));
  });

  test("a response with a foreign id is rejected — result and error branches both gated", async () => {
    for (const rpc of [
      { jsonrpc: "2.0", id: "someone-elses-id", result: { structuredContent: OK_STRUCTURED } },
      { jsonrpc: "2.0", id: "someone-elses-id", error: { code: -32000, message: "nope" } },
    ]) {
      const { fetchImpl } = mockFetch(
        () =>
          new Response(JSON.stringify(rpc), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      );
      const outcome = await sendProposeBatch(KEY, tinyRequest(), { fetchImpl });
      assert.ok(!outcome.ok, JSON.stringify(rpc));
      assert.ok(
        outcome.message.includes("not the JSON-RPC 2.0 response to this request"),
        JSON.stringify(rpc),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// runDbtCheck --save in-process: failure paths end-to-end (no child process,
// no network — fetch is injected through the saveTransport test seam)
// ---------------------------------------------------------------------------

/**
 * Run runDbtCheck with stdout/stderr captured; restores the real streams.
 *
 * The command writes STRINGS only, while the test runner's child-process
 * reporting can flush Buffer chunks through the same streams at any idle
 * moment (the timeout test waits ~30ms) — so the stubs capture string
 * chunks as the command's output and forward everything else untouched.
 */
async function runSaveInProcess(
  fetchImpl: typeof fetch,
  extra: Partial<DbtCheckOptions> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = "";
  let stderr = "";
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  const restoreOut = process.stdout.write;
  const restoreErr = process.stderr.write;
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (typeof chunk === "string") {
      stdout += chunk;
      return true;
    }
    return (origOut as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (typeof chunk === "string") {
      stderr += chunk;
      return true;
    }
    return (origErr as (...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stderr.write;
  try {
    const code = await runDbtCheck({
      targetPath: join(FIXTURES, "phantom-column"),
      json: true,
      save: true,
      key: KEY,
      version: CLI_VERSION,
      saveTransport: { fetchImpl, timeoutMs: 200 },
      ...extra,
    });
    return { code, stdout, stderr };
  } finally {
    process.stdout.write = restoreOut;
    process.stderr.write = restoreErr;
  }
}

/** stdout under --json must be exactly the drift report document — nothing else. */
function assertStdoutIsPureReport(stdout: string): void {
  const report = JSON.parse(stdout) as { findings: unknown[] };
  assert.equal(stdout, `${JSON.stringify(report, null, 2)}\n`);
  assert.ok(Array.isArray(report.findings), "stdout is the drift report");
}

describe("runDbtCheck --save failure paths (in-process)", () => {
  test("401: exit 2, fixed local message on stderr, pure stdout, exactly one call", async () => {
    const { calls, fetchImpl } = mockFetch(
      () =>
        new Response(
          JSON.stringify({ error: "invalid_context_key", how_to_fix: "EVIL https://phish.example" }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
    );
    const { code, stdout, stderr } = await runSaveInProcess(fetchImpl);
    assert.equal(code, 2);
    assert.equal(calls.length, 1, "no retries");
    assertStdoutIsPureReport(stdout);
    assert.ok(stderr.includes("HTTP 401"));
    assert.ok(stderr.includes("https://clarilayer.com/connect-ai"));
    assert.ok(!stderr.includes("phish.example"), "remote text must not reach the terminal");
    assert.ok(!stderr.includes("EVIL"));
  });

  test("413: exit 2, message on stderr, pure stdout, exactly one call", async () => {
    const { calls, fetchImpl } = mockFetch(() => new Response("too big", { status: 413 }));
    const { code, stdout, stderr } = await runSaveInProcess(fetchImpl);
    assert.equal(code, 2);
    assert.equal(calls.length, 1);
    assertStdoutIsPureReport(stdout);
    assert.ok(stderr.includes("413"));
    assert.ok(stderr.includes("--save-top"));
  });

  test("429: exit 2, Retry-After surfaced on stderr, pure stdout, exactly one call", async () => {
    const { calls, fetchImpl } = mockFetch(
      () => new Response("", { status: 429, headers: { "retry-after": "7" } }),
    );
    const { code, stdout, stderr } = await runSaveInProcess(fetchImpl);
    assert.equal(code, 2);
    assert.equal(calls.length, 1);
    assertStdoutIsPureReport(stdout);
    assert.ok(stderr.includes("429"));
    assert.ok(stderr.includes("7 seconds"));
  });

  test("JSON-RPC error: exit 2, key-scrubbed message on stderr, exactly one call", async () => {
    const rpcError = {
      jsonrpc: "2.0",
      id: JSONRPC_REQUEST_ID,
      error: { code: -32000, message: `rejected for ${KEY}` },
    };
    const { calls, fetchImpl } = mockFetch(
      () =>
        new Response(JSON.stringify(rpcError), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const { code, stdout, stderr } = await runSaveInProcess(fetchImpl);
    assert.equal(code, 2);
    assert.equal(calls.length, 1);
    assertStdoutIsPureReport(stdout);
    assert.ok(stderr.includes("rejected for"));
    assert.ok(!stderr.includes(KEY), "the key must never be printed");
    assert.ok(stderr.includes("cl_[redacted]"));
  });

  test("timeout: exit 2, timeout message on stderr, exactly one call", async () => {
    let callCount = 0;
    const fetchImpl: typeof fetch = (_input, init) => {
      callCount++;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      });
    };
    const { code, stdout, stderr } = await runSaveInProcess(fetchImpl, {
      saveTransport: { fetchImpl, timeoutMs: 30 },
    });
    assert.equal(code, 2);
    assert.equal(callCount, 1, "no retries after the abort");
    assertStdoutIsPureReport(stdout);
    assert.ok(stderr.includes("timed out"));
  });

  test("partial SUCCESS echoing the key: terminal output is scrubbed, exit 0", async () => {
    // ok:true is not a safe harbor — dropped details and console_url are
    // server-derived and go through the same scrubber as failure messages.
    const structured = {
      ok: true,
      results: [
        { index: 0, status: "proposed", type: "schema_note", name: "tickets.customer_email", id: "e_1" },
        {
          index: 1,
          status: "dropped",
          type: "schema_note",
          name: "tickets.tag",
          reason: "backlog_full",
          detail: `rejected while holding ${KEY}`,
        },
      ],
      summary: { received: 3, proposed: 2, duplicate: 0, dropped: 1 },
      pending_count: 12,
      console_url: `https://clarilayer.com/console/inbox?k=${KEY}`,
    };
    const { calls, fetchImpl } = mockFetch(
      () =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: JSONRPC_REQUEST_ID, result: { structuredContent: structured } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const { code, stdout, stderr } = await runSaveInProcess(fetchImpl);
    assert.equal(code, 0); // partial acceptance is still a completed run
    assert.equal(calls.length, 1);
    assertStdoutIsPureReport(stdout); // json mode: save lines go to stderr
    assert.ok(!stdout.includes(KEY));
    assert.ok(!stderr.includes(KEY), "the key must never reach the terminal");
    assert.ok(stderr.includes("cl_[redacted]"));
    assert.ok(stderr.includes("backlog_full"));
    assert.ok(stderr.includes("Review in your Inbox: https://clarilayer.com/console/inbox?k=cl_[redacted]"));
  });

  test("a run that already saved is not invited to preview a save", async () => {
    // The only path where --save reaches the terminal rendering: a live,
    // successful save with the report on stdout. The next-step line exists to
    // give an unsaved run somewhere to go, so it must not appear here.
    const { fetchImpl } = mockFetch(
      () =>
        new Response(JSON.stringify(OK_RPC), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const { code, stdout } = await runSaveInProcess(fetchImpl, { json: false });
    assert.equal(code, 0);
    assert.ok(stdout.includes("Phantom columns ("), "the terminal report is on stdout");
    assert.ok(stdout.includes("Staged 1 of 1 proposal"), "save status joins stdout here");
    assert.ok(!stdout.includes("--save --dry-run"));
  });

  test("--dry-run makes zero network calls even with fetch globally broken", async () => {
    const { calls, fetchImpl } = mockFetch(() => {
      throw new Error("network hit during dry-run");
    });
    const origFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("global fetch hit during dry-run");
    }) as typeof fetch;
    try {
      const { code, stdout, stderr } = await runSaveInProcess(fetchImpl, {
        dryRun: true,
        json: false,
      });
      assert.equal(code, 0);
      assert.equal(calls.length, 0, "the injected transport must never be used");
      const request = JSON.parse(stdout) as { method?: string };
      assert.equal(stdout, `${JSON.stringify(request, null, 2)}\n`);
      assert.equal(request.method, "tools/call");
      assert.ok(stderr.includes("nothing was sent"));
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

describe("renderSaveResultLines", () => {
  const fullSuccess: ProposeBatchResult = {
    ok: true,
    results: [{ index: 0, status: "proposed", type: "schema_note", name: "orders.tag", id: "e_1" }],
    summary: { received: 1, proposed: 1, duplicate: 0, dropped: 0 },
    pending_count: 4,
    console_url: "https://clarilayer.com/console/inbox",
  };

  test("review language: asserted-on-accept, never a stronger claim", () => {
    const lines = renderSaveResultLines(fullSuccess, keyRedactor(KEY));
    assert.equal(
      lines[0],
      "Staged 1 of 1 proposal for your review — they land as asserted entries if you accept them.",
    );
    const joined = lines.join("\n");
    assert.ok(!/verified/i.test(joined));
    assert.ok(joined.includes("Review in your Inbox: https://clarilayer.com/console/inbox"));
    assert.ok(lines[lines.length - 1].includes("https://clarilayer.com/connect-ai"));
  });

  test("success-path server strings are scrubbed: dropped name/reason/detail and console_url never leak the key", () => {
    const echoing: ProposeBatchResult = {
      ok: true,
      results: [
        { index: 0, status: "proposed", type: "schema_note", name: "orders.tag", id: "e_1" },
        {
          index: 1,
          status: "dropped",
          type: "schema_note",
          name: `ghost ${KEY}`,
          reason: `rejected_${KEY}`,
          detail: `the server saw ${KEY} on this item`,
        },
      ],
      summary: { received: 2, proposed: 1, duplicate: 0, dropped: 1 },
      pending_count: 4,
      console_url: `https://clarilayer.com/console/inbox?k=${KEY}`,
    };
    const lines = renderSaveResultLines(echoing, keyRedactor(KEY));
    const joined = lines.join("\n");
    assert.ok(!joined.includes(KEY), "the key must never appear in rendered output");
    assert.ok(joined.includes("cl_[redacted]"));
    assert.ok(joined.includes("not staged: ghost cl_[redacted]"));
    assert.ok(joined.includes("Review in your Inbox: https://clarilayer.com/console/inbox?k=cl_[redacted]"));
  });

  test("partial acceptance: dropped reasons and duplicates are itemized; no Inbox line without console_url", () => {
    const partial: ProposeBatchResult = {
      ok: true,
      results: [
        { index: 0, status: "proposed", type: "schema_note", name: "orders.tag", id: "e_1" },
        { index: 1, status: "duplicate", type: "schema_note", name: "orders.amount" },
        {
          index: 2,
          status: "dropped",
          type: "schema_note",
          name: "ghost",
          reason: "backlog_full",
          detail: "your Inbox already holds 200 pending items",
        },
      ],
      summary: { received: 3, proposed: 1, duplicate: 1, dropped: 1 },
      pending_count: 200,
      console_url: null,
    };
    const lines = renderSaveResultLines(partial, keyRedactor(KEY), [
      { name: "big", reason: "local_item_cap" },
    ]);
    const joined = lines.join("\n");
    assert.ok(lines[0].startsWith("Staged 1 of 3 proposals"));
    assert.ok(joined.includes("1 already pending in your Inbox (duplicate)."));
    assert.ok(
      joined.includes("not staged: ghost — backlog_full (your Inbox already holds 200 pending items)"),
    );
    assert.ok(joined.includes("not sent (local size cap): big"));
    assert.ok(!joined.includes("Review in your Inbox"));
    assert.ok(joined.includes("https://clarilayer.com/connect-ai"));
  });
});
