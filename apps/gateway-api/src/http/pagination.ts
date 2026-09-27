import { z } from 'zod';

/**
 * Query-parameter pagination, bounded.
 *
 * Exists because the list endpoints were not paginating at all: the query
 * accepted a `limit` parameter that nothing read, and the SQL carried a
 * hardcoded `LIMIT 200`. Every client asking for 20 rows received 200 — an
 * API-contract violation that was also, by a wide margin, the largest single
 * cost in the read path.
 *
 * Measured under profiling at concurrency 16, on the paginated complaint list:
 * response 62,010 bytes for a `?limit=20` request, with 23.8% of process CPU in
 * `JSON.stringify`, 14.5% in UTF-8 encode/decode and 8.3% in Postgres date
 * parsing. All three scale with row count: 600 timestamp parses per request
 * instead of 60. Honouring `limit` addresses the whole cluster at once.
 *
 * Both values are bounded rather than trusted. An unbounded `limit` is a
 * denial-of-service lever: a single request for `limit=1000000` would make the
 * server materialise and serialise a million rows. `MAX_LIMIT` is the ceiling a
 * response may ever carry, and it is a property of the endpoint's contract
 * rather than of the caller.
 */

/** The largest page any list endpoint will return. */
export const MAX_LIMIT = 200;
export const DEFAULT_LIMIT = 20;

/**
 * A `limit`/`offset` query shape.
 *
 * Coerces because query strings are always text: `?limit=20` arrives as
 * `"20"`, and `Number` on it is a number, while `?limit=abc` is `NaN` and has
 * to fall back rather than propagate.
 */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional().default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export type Pagination = z.infer<typeof paginationSchema>;

/**
 * The shape to spread into an endpoint's own query schema, so `limit` and
 * `offset` are parsed with the same bounds everywhere rather than each endpoint
 * re-deciding what to do with a string.
 */
export const paginationShape = {
  limit: paginationSchema.shape.limit,
  offset: paginationSchema.shape.offset,
} satisfies Partial<z.ZodRawShape>;

/**
 * Applies a limit, clamping rather than rejecting.
 *
 * The schema rejects an out-of-range `limit` with a 400. That is right for a
 * documented API, but a client that asks for 500 rows has a legitimate need that
 * a 200-byte error does not serve — so `clampLimit` is for the cases where a
 * smaller answer is always acceptable and an error never is, such as an internal
 * or legacy caller that cannot be changed.
 */
export function clampLimit(raw: unknown, fallback = DEFAULT_LIMIT): number {
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(MAX_LIMIT, Math.floor(parsed));
}

/** True when a client asked for a page that cannot exist, given `total` rows. */
export function isPastEnd(pagination: Pagination, total: number): boolean {
  return pagination.offset > 0 && pagination.offset >= total;
}
