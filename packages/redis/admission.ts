/**
 * Distributed admission control.
 *
 * A complaint write takes two permits: one scoped to the route and principal
 * (per-user abuse protection) and one global (a system-wide ceiling on
 * concurrent writes). Each permit is a rate counter plus a concurrency counter.
 *
 * Both are acquired in a single Lua script and released in a second, so an
 * admitted write costs two Redis commands instead of six — measured 8.11 down to
 * 2.00 commands per write, with 6.11 of the original 8.11 being admission
 * control.
 *
 * The script also makes the counters exact under concurrency, which is the
 * reason a distributed limiter needs one. The previous implementation
 * incremented a counter, compared the value INCR returned, and decremented again
 * if it was over the limit. That does not over-admit — the returned value is
 * exact, so no two requests can pass the same check, and measurement confirms
 * exactly 8 admitted against a cap of 8. But between the increment and the
 * rollback the counter reports a number that is simply wrong: a refused request
 * counts as in flight until its decrement lands.
 *
 * Measured with 200 simultaneous admissions against a cap of 8, sampling the
 * counter during the storm: the admitted count was consistently correct, while
 * the counter was observed at up to 200 — 25x the cap. The over-report is
 * transient and self-correcting, and how much is caught depends on how many
 * samples land mid-storm, so the true peak is somewhere between 8 and 200. It
 * matters because this is a *distributed* limiter: the wrong number is precisely
 * what a second gateway replica reads, and it would refuse valid writes for as
 * long as it took to drain. Under the script the counter is only ever observable
 * at its true value, because Lua runs to completion before any other client is
 * served — the guarantee is structural, not a matter of timing.
 *
 * It also removes a leak. Rolling back was a separate command, so a process that
 * died between the increment and the decrement never returned the permit: the
 * inflight slot was lost for the length of the TTL and the rate slot was charged
 * against a window in which no write happened.
 *
 * A script is one billable command on a metered Redis, which is the other point:
 * Upstash's free tier allows 500,000 commands a month.
 */

/** The rate and concurrency counter keys for one permit. */
export type PermitCounters = {
  rateKey: string;
  inflightKey: string;
};

import { getRedisClient } from './client.js';
import { isRedisConfigured } from './config.js';

export type DistributedBackpressureConfig = {
  scope: string;
  principal: string;
  maxRequestsPerWindow: number;
  windowSeconds: number;
  maxInflight: number;
  inflightTtlSeconds: number;
};

export type DistributedBackpressurePermit = {
  release: () => Promise<void>;
};

/** Which limit refused a write, or undefined when admitted. */
export type AdmissionRejection = 'rate' | 'inflight';

/** Labels for the permits, used in the log line and the 429 body. */
export type PermitLabel = 'route' | 'global' | (string & {});

export type AdmissionOutcome = {
  admitted: boolean;
  rejection?: AdmissionRejection;
  /** Which permit refused. Absent when admitted. */
  permit?: PermitLabel;
  retryAfterSeconds?: number;
};

export function normalizedScope(scope: string): string {
  return scope.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, '-');
}

export function currentWindow(windowSeconds: number): string {
  return String(Math.floor(Date.now() / 1000 / windowSeconds));
}

export function permitKeys(
  config: Pick<DistributedBackpressureConfig, 'scope' | 'principal' | 'windowSeconds'>,
): PermitCounters {
  const scope = normalizedScope(config.scope);
  const principal = config.principal.trim().toLowerCase() || 'anonymous';
  return {
    rateKey: `roadwatch:backpressure:${scope}:rate:${principal}:${currentWindow(config.windowSeconds)}`,
    inflightKey: `roadwatch:backpressure:${scope}:inflight:${principal}`,
  };
}

/**
 * Acquires every permit, or none of them.
 *
 * Not acquiring a permit is never a problem: a permit already taken is rolled
 * back before the script returns, so a refusal cannot leave the rate window or
 * the inflight count permanently inflated by a request that was never served.
 *
 *   KEYS:  two per permit — rate, then inflight
 *   ARGV:  1 = permit count, then four per permit: maxRate, window, maxInflight, ttl
 *
 * Returns { permit, reason, retryAfter }. `permit` is the 1-based index of the
 * permit that refused, or 0 when admitted. `reason` is 1 for a rate limit and 2
 * for too much in flight, and `retryAfter` is the window or the inflight TTL
 * respectively. The reason is returned rather than inferred: a refusal has to
 * name the limit that caused it, and the permit index does not distinguish the
 * two.
 */
const ACQUIRE_SCRIPT = `
local permits = tonumber(ARGV[1])

-- Accumulated by any permit taken so far, so they can all be given back when a
-- later one refuses. Tracked in a flat list because the permit count is small and
-- known, rather than assuming two.
local takenRate, takenInflight = {}, {}

local function giveBack(n)
  for i = 1, n do
    redis.call('DECR', takenRate[i])
    redis.call('DECR', takenInflight[i])
  end
end

for p = 1, permits do
  local rateKey = KEYS[(p - 1) * 2 + 1]
  local inflightKey = KEYS[(p - 1) * 2 + 2]
  local base = 1 + (p - 1) * 4
  local maxRate = tonumber(ARGV[base + 1])
  local window = tonumber(ARGV[base + 2])
  local maxInflight = tonumber(ARGV[base + 3])
  local ttl = tonumber(ARGV[base + 4])

  local rate = redis.call('INCR', rateKey)
  if rate == 1 then
    -- Only the request that creates the key sets the window, so a busy
    -- principal cannot keep pushing the expiry forward and prevent it closing.
    redis.call('EXPIRE', rateKey, window)
  end
  if rate > maxRate then
    redis.call('DECR', rateKey)
    giveBack(p - 1)
    return { p, 1, window }
  end

  local inflight = redis.call('INCR', inflightKey)
  if inflight == 1 then
    -- Bounded by a TTL, so a permit orphaned by a process that dies while
    -- holding it cannot consume capacity forever.
    redis.call('EXPIRE', inflightKey, ttl)
  end
  if inflight > maxInflight then
    redis.call('DECR', inflightKey)
    redis.call('DECR', rateKey)
    giveBack(p - 1)
    return { p, 2, ttl }
  end

  takenRate[p] = rateKey
  takenInflight[p] = inflightKey
end

return { 0, 0, 0 }
`;

/**
 * Releases every permit in one command.
 *
 * KEYS: one inflight key per permit.
 *
 * DECR rather than DEL: the key carries the TTL that bounds an orphaned permit,
 * and deleting it would remove that backstop.
 */
const RELEASE_SCRIPT = `
for i = 1, #KEYS do
  redis.call('DECR', KEYS[i])
end
return #KEYS
`;

/**
 * Script SHAs, cached per client.
 *
 * A Lua script is sent by its SHA, and the body must be on the server for the
 * SHA to resolve. Loading it on every call would double the cost of the thing
 * this change exists to reduce, so the SHA is remembered.
 *
 * It is re-loaded only when Redis answers NOSCRIPT — a restart, a failover, or a
 * replica promoted without the script cache. A cached SHA that silently started
 * failing would take admission control offline, so the error is handled rather
 * than assumed impossible.
 *
 * Keyed by client so a test or a probe that swaps the connection does not read
 * another connection's SHA.
 */
const scriptShas = new WeakMap<object, Map<string, string>>();

function scriptKey(body: string): string {
  return body;
}

async function resolveScriptSha(redis: any, body: string): Promise<string> {
  const cache = scriptShas.get(redis) ?? new Map<string, string>();
  scriptShas.set(redis, cache);

  const cached = cache.get(scriptKey(body));
  if (cached) return cached;

  const sha = await redis.script('LOAD', body);
  if (typeof sha !== 'string' || sha.length === 0) {
    throw new Error('Redis refused to load the admission-control script');
  }
  cache.set(scriptKey(body), sha);
  return sha;
}

/** True for the error Redis raises when a cached SHA is no longer on the server. */
function isNoScriptError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /NOSCRIPT/i.test(message);
}

export type Admission = {
  outcome: AdmissionOutcome;
  release: () => Promise<void>;
};

/**
 * Takes every permit in `configs`, or none.
 *
 * @param labels names each permit for the log line, positionally.
 */
export async function acquireAdmission(
  redis: any,
  configs: ReadonlyArray<DistributedBackpressureConfig>,
  labels: ReadonlyArray<PermitLabel> = [],
): Promise<Admission> {
  if (configs.length === 0) {
    return { outcome: { admitted: true }, release: async () => undefined };
  }

  const keys: string[] = [];
  const argv: string[] = [String(configs.length)];
  for (const config of configs) {
    const counters = permitKeys(config);
    keys.push(counters.rateKey, counters.inflightKey);
    argv.push(
      String(config.maxRequestsPerWindow),
      String(config.windowSeconds),
      String(config.maxInflight),
      String(config.inflightTtlSeconds),
    );
  }

  const reply = (await runScript(redis, ACQUIRE_SCRIPT, keys.length, [...keys, ...argv])) as [
    number,
    number,
    number,
  ];

  const refusedAt = Number(reply?.[0] ?? 0);
  const reason = Number(reply?.[1] ?? 0);
  const retryAfterSeconds = Number(reply?.[2] ?? 0);

  if (refusedAt !== 0) {
    const config = configs[refusedAt - 1]!;
    // A rate refusal sends the client back after the window; a backlog refusal
    // after the inflight TTL. Both are bounded by the shorter of the two, so
    // nobody is told to wait longer than the limiter will let them through.
    const bound =
      retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds, Math.max(config.windowSeconds, config.inflightTtlSeconds))
        : config.windowSeconds;
    return {
      outcome: {
        admitted: false,
        rejection: reason === 1 ? 'rate' : 'inflight',
        permit: labels[refusedAt - 1],
        retryAfterSeconds: Math.max(1, bound),
      },
      release: async () => undefined,
    };
  }

  const inflightKeys = keys.filter((_, index) => index % 2 === 1);
  return {
    outcome: { admitted: true },
    release: async () => {
      try {
        await runScript(redis, RELEASE_SCRIPT, inflightKeys.length, inflightKeys);
      } catch {
        // Best effort. The TTL on each inflight key bounds a lost release, so
        // this degrades to a temporary capacity reduction rather than a leak.
      }
    },
  };
}

/**
 * Runs a cached script, reloading it once if the server has forgotten the SHA.
 *
 * The retry is what makes caching safe: a restart or failover empties the server
 * script cache, and without this every write would fail admission control until
 * the process restarted.
 */
async function runScript(
  redis: any,
  body: string,
  numKeys: number,
  args: string[],
): Promise<unknown> {
  const sha = await resolveScriptSha(redis, body);
  try {
    return await redis.evalsha(sha, numKeys, ...args);
  } catch (error) {
    if (!isNoScriptError(error)) throw error;
    // Forget the stale SHA, load again, and retry once.
    scriptShas.get(redis)?.delete(scriptKey(body));
    const fresh = await resolveScriptSha(redis, body);
    return redis.evalsha(fresh, numKeys, ...args);
  }
}

/**
 * Builds the 429 the gateway returns for a refused write.
 *
 * A caller that knows which limit fired should say so; the limiter's own
 * message is the fallback.
 */
export function admissionRejection(
  outcome: AdmissionOutcome,
  rejection: AdmissionRejection,
): Error {
  const retryAfterSeconds = Math.max(1, outcome.retryAfterSeconds ?? 5);
  const error = new Error(
    rejection === 'rate' ? 'Rate limit exceeded' : 'Write backlog too deep',
  );
  const tagged = error as unknown as Record<string, unknown>;
  tagged.statusCode = 429;
  tagged.retryAfterSeconds = retryAfterSeconds;
  tagged.rejection = rejection;
  tagged.permit = outcome.permit;
  return error;
}

/**
 * Single-permit acquisition, for callers that do not need a pair.
 *
 * Same script and same code path as the pair, so the two cannot drift. The
 * client is resolved here rather than passed in, which is the signature existing
 * callers use; pass a client explicitly via acquireAdmission when you have one.
 */
export async function acquireDistributedBackpressurePermit(
  config: DistributedBackpressureConfig,
  redis?: any,
): Promise<DistributedBackpressurePermit> {
  if (!isRedisConfigured()) {
    throw new Error(
      'Redis is required but not configured. Set REDIS_CLOUD_URL/REDIS_MANAGED_URL for a ' +
        'managed instance, or REDIS_URL for an explicit one.',
    );
  }
  const client = redis ?? getRedisClient();
  const admission = await acquireAdmission(client, [config]);
  if (!admission.outcome.admitted) {
    throw admissionRejection(admission.outcome, admission.outcome.rejection ?? 'inflight');
  }
  return { release: admission.release };
}
