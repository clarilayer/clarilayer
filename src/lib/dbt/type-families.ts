/**
 * Warehouse type → type-family mapping.
 *
 * Declared YAML `data_type` strings and warehouse-introspected catalog types
 * rarely match verbatim ("varchar(255)" vs "character varying", "INT64" vs
 * "integer"). Comparing raw strings would drown users in false positives, so
 * the drift engine only compares coarse FAMILIES — and only flags a mismatch
 * when BOTH sides map to a known family and the families differ. An unknown
 * type on either side is never flagged: silence over noise.
 */

/** Coarse type families the drift engine compares. */
export type TypeFamily =
  | "string"
  | "numeric"
  | "bool"
  | "timestamp"
  | "date"
  | "semi_structured";

/**
 * Base-type spellings → family. Keys are lowercase, with any `(...)` size or
 * `<...>` parameter suffix already stripped (see {@link typeFamily}). Covers
 * the common spellings across Postgres, Snowflake, BigQuery, Redshift, and
 * Databricks; anything absent maps to "unknown" (null) on purpose.
 */
const FAMILY_BY_TYPE: Readonly<Record<string, TypeFamily>> = {
  // string
  varchar: "string",
  text: "string",
  string: "string",
  "character varying": "string",
  char: "string",
  character: "string",
  nvarchar: "string",
  str: "string",
  // numeric
  number: "numeric",
  numeric: "numeric",
  decimal: "numeric",
  int: "numeric",
  int64: "numeric",
  integer: "numeric",
  bigint: "numeric",
  smallint: "numeric",
  float: "numeric",
  float64: "numeric",
  double: "numeric",
  "double precision": "numeric",
  real: "numeric",
  tinyint: "numeric",
  serial: "numeric",
  // bool
  boolean: "bool",
  bool: "bool",
  // timestamp
  timestamp: "timestamp",
  timestamp_tz: "timestamp",
  timestamptz: "timestamp",
  "timestamp with time zone": "timestamp",
  "timestamp without time zone": "timestamp",
  timestamp_ntz: "timestamp",
  timestamp_ltz: "timestamp",
  datetime: "timestamp",
  // date
  date: "date",
  // semi-structured
  json: "semi_structured",
  jsonb: "semi_structured",
  variant: "semi_structured",
  struct: "semi_structured",
  record: "semi_structured",
  array: "semi_structured",
};

/**
 * Map a raw type string ("VARCHAR(255)", "ARRAY<STRING>", "timestamp_ntz") to
 * its family, or null when the base type is not in the known table.
 */
export function typeFamily(rawType: string | null | undefined): TypeFamily | null {
  if (typeof rawType !== "string") return null;
  // Everything before the first "(" or "<" is the base type; the rest is a
  // size/precision or element parameter ("numeric(38,0)", "array<string>").
  const base = rawType.split(/[(<]/, 1)[0].trim().toLowerCase();
  if (base === "") return null;
  return FAMILY_BY_TYPE[base] ?? null;
}
