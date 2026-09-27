/**
 * Gateway entry wrapped in a programmatic CPU profile, for the *built* output.
 *
 * Two reasons this exists separately from profiled-entry.mts:
 *
 *  * Profiling `tsx src/index.ts` measures the dev runtime. The ESM loader hooks
 *    cost 3.5-4.7% of CPU in those runs, and the built output has none of it.
 *    Optimising against the dev profile optimises for overhead that does not ship.
 *  * The build is what actually runs, so its numbers are the ones that transfer to
 *    a capacity decision.
 *
 * It also reports how many signal handlers the gateway installs, because
 * "does the service drain on SIGTERM" decides whether a rolling deploy on
 * Kubernetes drops requests, and it is answered here on every run rather than
 * assumed.
 *
 * Usage: node ops/profile/profiled-dist.mts <out.cpuprofile> <gateway-dist-entry>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector';
import { promisify } from 'node:util';

const outPath = process.argv[2];
const entry = process.argv[3] ?? '../../apps/gateway-api/dist/index.js';
if (!outPath) {
  console.error('usage: node ops/profile/profiled-dist.mts <out.cpuprofile> [entry]');
  process.exit(1);
}

const session = new Session();
session.connect();
const post = promisify(
  (method: string, params?: object, cb: (e: Error | null, r?: object) => void) =>
    session.post(method as never, params as never, cb as never),
).bind(session) as (method: string, params?: object) => Promise<object>;

function cpuTicksTree(root: number): number {
  const children: number[] = [];
  let entries: string[] = [];
  try {
    entries = readFileSync('/proc/self/task/0/children', 'utf8').trim().split(/\s+/);
  } catch {
    // Not Linux or not readable; the root's own CPU is still counted.
  }
  for (const entryPid of entries) {
    const pid = Number(entryPid);
    if (Number.isInteger(pid) && pid > 0) children.push(pid);
  }

  let total = 0;
  const read = (pid: number): number => {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      // The comm field is parenthesised and may contain spaces, so the line is
      // split after the final ')' and utime/stime are fields 12 and 13 of what
      // remains.
      const rest = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
      return Number(rest[11]) + Number(rest[12]);
    } catch {
      return 0;
    }
  };
  total += read(root);
  for (const pid of children) total += read(pid) + cpuTicksTree(pid);
  return total;
}

const startedTicks = cpuTicksTree(process.pid);

await post('Profiler.enable');
await post('Profiler.setSamplingInterval', { interval: 200 });
await post('Profiler.start');
console.error('[profile] started on built output');

let stopped = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  const before = { term: process.listenerCount('SIGTERM'), int: process.listenerCount('SIGINT') };
  process.on(signal, () => {
    if (stopped) return;
    stopped = true;
    const termDelta = process.listenerCount('SIGTERM') - before.term;
    const intDelta = process.listenerCount('SIGINT') - before.int;
    console.error(
      `[profile] ${signal} received; gateway installed ` +
        `term=${termDelta} int=${intDelta} handler(s). ` +
        `0 means the process dies on the signal with no drain.`,
    );
    void (async () => {
      try {
        const { profile } = (await post('Profiler.stop')) as { profile: object };
        writeFileSync(outPath, JSON.stringify(profile));
        console.error(`[profile] written: ${outPath}`);
      } catch (error) {
        console.error('[profile] FAILED:', error instanceof Error ? error.message : String(error));
      }
      console.error(`[profile] cpu_seconds=${((cpuTicksTree(process.pid) - startedTicks) / 100).toFixed(3)}`);
      process.exit(0);
    })();
  });
}

await import(entry);
