# Recipe: Bootstrap your context from SQL you already have

**Goal:** go from an empty store to day-1 useful context, without typing it all by hand.

**You have:** a folder of `.sql` files (and maybe dbt models or a `CLAUDE.md`).

## Steps

1. Make sure ClariLayer is connected ([QUICKSTART](../QUICKSTART.md)).
2. In your agent, point `bootstrap` at your artifacts:

   > Bootstrap my ClariLayer context from the SQL in `./analytics/sql`. Also import my dbt models in `./models` and my existing `./CLAUDE.md`.

3. Your agent calls `bootstrap`. What happens to each source:
   - **SQL** → validated and **deterministically structured** (tables, joins, group-bys, time grain).
   - **dbt models** → imported and stored as schema-notes (raw content + light metadata).
   - **`CLAUDE.md` / notes** → imported and stored as notes.
4. `recall` something to confirm it landed:

   > What context do you have about revenue?

## Notes

- `bootstrap` is bounded and deduped — re-running it won't create a mess.
- ClariLayer doesn't read your filesystem or warehouse directly; **your agent** supplies the content it already has access to.
- Query-history ingestion is on the roadmap, not a bootstrap source today.

Try it with the sample files in [`../examples/analytics/sql`](../examples/analytics/sql).
