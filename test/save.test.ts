/**
 * `--save` payload mapping and transport, all without a network:
 *   - buildSaveItems: severity-then-object selection, the 24+1 cap,
 *     display_name usage, exact body shape, size pre-checks;
 *   - buildProposeBatchRequest: the one JSON-RPC body shape;
 *   - sendProposeBatch: mocked fetch pinning all three headers, the
 *     single-call contract, and every terminal failure path (401 with
 *     how_to_fix surfaced, 413, 429, JSON-RPC error, network, timeout);
 *   - renderSaveResultLines: the review-language contract and partial
 *     acceptance (backlog_full) reporting.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { analyzeDrift } from "../src/lib/dbt/engine.js";
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
  renderSaveResultLines,
  sendProposeBatch,
  type BuildSaveItemsOptions,
  type ProposalItem,
  type ProposeBatchResult,
} from "../src/lib/save.js";

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

  test("parses the JSON-RPC response out of an SSE body", async () => {
    const body = `: ping\n\nevent: message\ndata: ${JSON.stringify(OK_RPC)}\n\n`;
    const { fetchImpl } = mockFetch(
      () =>
        new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    );
    const outcome = await sendProposeBatch(KEY, tinyRequest(), { fetchImpl });
    assert.ok(outcome.ok);
    assert.equal(outcome.result.summary.received, 1);
  });

  test("401: the server's how_to_fix is surfaced verbatim", async () => {
    const howToFix = "Mint a new context key in the ClariLayer console, then rerun with --key.";
    const { fetchImpl } = mockFetch(
      () =>
        new Response(JSON.stringify({ error: "invalid_context_key", how_to_fix: howToFix }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    );
    const outcome = await sendProposeBatch(KEY, tinyRequest(), { fetchImpl });
    assert.ok(!outcome.ok);
    assert.ok(outcome.message.includes("401"));
    assert.ok(outcome.message.includes("invalid_context_key"));
    assert.ok(outcome.message.includes(howToFix), "how_to_fix must appear verbatim");
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
    const lines = renderSaveResultLines(fullSuccess);
    assert.equal(
      lines[0],
      "Staged 1 of 1 proposal for your review — they land as asserted entries if you accept them.",
    );
    const joined = lines.join("\n");
    assert.ok(!/verified/i.test(joined));
    assert.ok(joined.includes("Review in your Inbox: https://clarilayer.com/console/inbox"));
    assert.ok(lines[lines.length - 1].includes("https://clarilayer.com/connect-ai"));
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
    const lines = renderSaveResultLines(partial, [{ name: "big", reason: "local_item_cap" }]);
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
