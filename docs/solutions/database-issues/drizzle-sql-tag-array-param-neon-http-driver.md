---
title: Drizzle sql Template Tag — Array Parameter Serialization with Neon HTTP Driver
category: database-issues
date: 2026-04-05
tags:
  - drizzle-orm
  - neon-postgres
  - sql-template
  - array-parameter
  - distinct-on
  - bigint
---

# Drizzle `sql` Template Tag — Array Parameter Serialization with Neon HTTP Driver

## Problem Description

When using Drizzle ORM's `sql` template tag with a JavaScript array passed directly as a template interpolation, the array is serialized as a PostgreSQL **row constructor tuple** `($1, $2, $3)` rather than a proper PostgreSQL array `ARRAY[$1, $2, $3]`. This causes queries using `= ANY(${array})` to produce invalid SQL that fails at the Neon Postgres HTTP driver level at runtime.

**Failing query produced:**
```sql
SELECT DISTINCT ON (market_id) market_id, view_count, like_count
FROM tiktok_polls
WHERE market_id = ANY(($1, $2, $3))
ORDER BY market_id, polled_at DESC
-- params: 0dece1fb-..., 964c3d66-..., f65c01cd-...
```

PostgreSQL's `ANY()` operator accepts either a subquery or an array — not a row constructor — so this fails at the driver level.

## Root Cause

Drizzle's `sql` template tag encodes a JS array passed as a parameter interpolation as a row constructor `(val1, val2, val3)`, not as a PostgreSQL array (`ARRAY[val1, val2, val3]`). This is a serialization mismatch between Drizzle's internal encoding and what PostgreSQL's `ANY()` operator actually accepts.

## Investigation Steps

1. Observed a runtime error from the Neon HTTP driver rejecting the query on page load.
2. Logged the generated SQL — confirmed it contained `ANY(($1, $2, $3))` — a row constructor, not an array.
3. Traced the interpolation to `` sql`... WHERE market_id = ANY(${feedIds})` `` where `feedIds` is a `string[]`.
4. Confirmed that Drizzle's `sql` template has no built-in mechanism to auto-convert a JS array to a PostgreSQL array literal when used as a direct interpolation.
5. Identified `sql.join` as the correct Drizzle utility to build a parameterized list, then wrapping it in `ARRAY[...]` syntax to produce a valid PostgreSQL array.

## Solution

### Before (broken)

```ts
// BROKEN — produces ANY(($1, $2, $3)) — row constructor, not array
const result = await db.execute(sql`
  SELECT DISTINCT ON (market_id) market_id, view_count, like_count
  FROM tiktok_polls
  WHERE market_id = ANY(${feedIds})
  ORDER BY market_id, polled_at DESC
`);
```

### After (correct)

```ts
// CORRECT — produces ANY(ARRAY[$1, $2, $3])
const idsLiteral = sql.join(feedIds.map((id) => sql`${id}`), sql`, `);
const result = await db.execute(sql`
  SELECT DISTINCT ON (market_id) market_id, view_count, like_count
  FROM tiktok_polls
  WHERE market_id = ANY(ARRAY[${idsLiteral}])
  ORDER BY market_id, polled_at DESC
`);
```

**Why this works:** `sql.join` concatenates individual `sql` fragments (each wrapping a single scalar value) with a separator, producing a flat sequence of bound parameters. Wrapping that in `ARRAY[...]` tells PostgreSQL to interpret the comma-separated parameters as an array constructor rather than a row constructor, which `ANY()` accepts correctly.

## Additional Gotchas (same `db.execute` surface)

Three other surprises discovered in the same debugging session — all specific to raw `db.execute` vs. Drizzle's typed query builder:

### 1. QueryResult row access

`db.execute` returns a `QueryResult` object. Rows are accessed via the `.rows` property — do not iterate the result directly:

```ts
// WRONG — iterating QueryResult directly
for (const row of result) { ... }

// CORRECT
for (const row of result.rows) { ... }
const { rows } = await db.execute(query); // or destructure
```

### 2. Snake_case column names in raw results

Raw `db.execute` results use the database column names (snake_case). Drizzle's ORM query layer handles camelCase mapping for you; raw results do not.

```ts
// WRONG — undefined silently
const count = row.viewCount;

// CORRECT
const count = row.view_count;
```

### 3. BigInt columns come back as strings from Neon HTTP driver

Columns typed as `bigint` in PostgreSQL (e.g., `view_count`, `like_count`) are returned as **strings** by the Neon HTTP driver, not as JS numbers or BigInts. Parse them explicitly at the mapping boundary:

```ts
// Map at boundary, not deep in logic
pollData = result.rows.map((r) => ({
  marketId: r.market_id as string,
  viewCount: r.view_count !== null ? BigInt(r.view_count as string) : null,
  likeCount: r.like_count !== null ? BigInt(r.like_count as string) : null,
}));
```

## Prevention

### Quick Reference: Broken → Correct

| Broken Pattern | Correct Pattern |
|---|---|
| `` sql`WHERE id = ANY(${ids})` `` | `` sql`WHERE id = ANY(ARRAY[${sql.join(ids.map(id => sql`${id}`), sql`, `)}])` `` |
| `` sql`WHERE id IN (${ids})` `` (array) | `` sql`WHERE id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})` `` |
| `const rows = await db.execute(q)` then `rows.map(...)` | `const { rows } = await db.execute(q)` then `rows.map(...)` |
| `row.userId` on raw result | `row.user_id` |
| `row.viewCount` on raw result | `row.view_count` |
| `row.viewCount + 1` where column is bigint | `Number(row.view_count as string) + 1` |

### Review Checklist for `db.execute` / `sql` template blocks

- [ ] No bare array interpolation: search for `` sql`...${someArray}... `` — if `someArray` is a JS array, rewrite with `sql.join`
- [ ] No `= ANY(${...})` with a plain variable — argument must be `ARRAY[...]` built via `sql.join`
- [ ] `.rows` is accessed, not the result object itself
- [ ] BigInt/numeric columns are parsed (`Number(...)` or `BigInt(...)`) at the mapping step
- [ ] Raw result column access uses snake_case, not camelCase

### Rule of Thumb

Any time you write `db.execute`, treat the result as an untyped database primitive — not a Drizzle model. That means: access `.rows`, read snake_case keys, parse every numeric column explicitly, and never let a JS array touch a `` sql`...` `` interpolation slot without going through `sql.join` first.

## Cross-References

- [`docs/solutions/database-issues/nextjs-financial-app-code-review-patterns.md`](nextjs-financial-app-code-review-patterns.md) — Pattern 4 (N+1 Elimination via VALUES CTE) uses `sql.join()` correctly for batch-update contexts. Pattern 2–3 show other `sql` template tag idioms in this codebase.
- [`docs/solutions/logic-errors/neon-timestamp-utc-offset-cron-cooldown-null-poll-guard.md`](../logic-errors/neon-timestamp-utc-offset-cron-cooldown-null-poll-guard.md) — contains a `WHERE market_id = ANY(ARRAY[...])` query in the same polling code path where this bug was introduced; also documents the SWR shared-fetcher-reference fix made in the same session.
- [`docs/solutions/logic-errors/tiktok-market-resolution-race-condition.md`](../logic-errors/tiktok-market-resolution-race-condition.md) — covers the broader cron/polling pipeline containing `db.execute` call sites where array parameters appear.
