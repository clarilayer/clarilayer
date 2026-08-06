import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { typeFamily } from "../src/lib/dbt/type-families.js";

describe("typeFamily", () => {
  test("maps common spellings across warehouses to the same family", () => {
    assert.equal(typeFamily("varchar"), "string");
    assert.equal(typeFamily("character varying"), "string");
    assert.equal(typeFamily("STRING"), "string");
    assert.equal(typeFamily("INT64"), "numeric");
    assert.equal(typeFamily("double precision"), "numeric");
    assert.equal(typeFamily("NUMBER"), "numeric");
    assert.equal(typeFamily("BOOLEAN"), "bool");
    assert.equal(typeFamily("timestamp_ntz"), "timestamp");
    assert.equal(typeFamily("TIMESTAMP WITH TIME ZONE"), "timestamp");
    assert.equal(typeFamily("datetime"), "timestamp");
    assert.equal(typeFamily("date"), "date");
    assert.equal(typeFamily("VARIANT"), "semi_structured");
    assert.equal(typeFamily("jsonb"), "semi_structured");
  });

  test("strips (...) precision and <...> parameters before mapping", () => {
    assert.equal(typeFamily("varchar(255)"), "string");
    assert.equal(typeFamily("NUMERIC(38,2)"), "numeric");
    assert.equal(typeFamily("ARRAY<STRING>"), "semi_structured");
    assert.equal(typeFamily("struct<a int64, b string>"), "semi_structured");
    assert.equal(typeFamily("  Number (10, 2) "), "numeric");
  });

  test("unknown or absent types map to null, never to a family", () => {
    assert.equal(typeFamily("hyperloglog"), null);
    assert.equal(typeFamily("supertype"), null);
    assert.equal(typeFamily(""), null);
    assert.equal(typeFamily("   "), null);
    assert.equal(typeFamily(null), null);
    assert.equal(typeFamily(undefined), null);
  });
});
