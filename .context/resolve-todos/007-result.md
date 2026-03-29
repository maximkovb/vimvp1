# Todo 007 Result: Bulk SQL for distributePayout / refundPositions

## Files Changed

- `src/lib/services/payout.ts`

## Approach Used

Replaced the per-position `for` loops in both `distributePayout` and `refundPositions` with bulk SQL statements using Drizzle's `sql` template tag and `sql.join`.

### distributePayout
- Early return when `toPay.length === 0`.
- Single `UPDATE users ... FROM (VALUES ...)` CTE to credit all winners' balances in one round-trip.
- Single `INSERT INTO coin_transactions ... VALUES (row1), (row2), ...` to record all payout ledger entries in one round-trip.
- Result: 2 DB writes total regardless of winner count (down from 2N sequential writes).

### refundPositions
- Pre-filters positions to only those with `refundAmount > 0`, early-returns if none.
- Single `UPDATE users ... FROM (VALUES ...)` CTE for all balance credits.
- Single `INSERT INTO coin_transactions ... VALUES ...` for all refund ledger entries.
- Single `UPDATE positions SET shares = '0' WHERE id IN (...)` to zero out all refunded positions.
- Result: 3 DB writes total regardless of position count (down from 3N sequential writes).

## Limitations / Follow-up

- **`sql.join` with large arrays**: For very large markets (e.g., thousands of positions), the VALUES list in the SQL statement could become large. A follow-up could add chunking (e.g., batches of 500 rows) if that becomes an issue. For typical prediction market sizes this is not a concern.
- **`balance` column type**: The schema declares `balance` as `decimal` (stored as a string in Drizzle's JS layer). The SQL casts use `::numeric` explicitly to ensure Postgres arithmetic correctness. The result is stored back as numeric, which Postgres will coerce back to the `decimal` column type cleanly.
- **`coinTransactions` unique index**: There is a unique index on `(user_id, reference_id, type)`. The existing idempotency check in `distributePayout` prevents duplicate payout inserts. `refundPositions` does not have an equivalent check — if called twice on the same market, the bulk INSERT will fail on the unique constraint. This matches the pre-existing behaviour (the old loop would also fail on duplicate).
- **Drizzle `sql.join` availability**: Requires Drizzle ORM >= 0.27. Confirmed present in the existing import (`import { eq, and, ne, sql } from "drizzle-orm"`).
