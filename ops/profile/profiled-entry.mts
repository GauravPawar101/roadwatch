/**
 * Gateway entry wrapped in a programmatic CPU profile.
 *
 * `--cpu-prof` was not usable here: the gateway installs no signal handler, so
 * the default SIGINT disposition terminated the process before the profiler
 * flushed, and no profile was written. Driving the inspector directly removes
 * the dependency on exit-time behaviour — the profile is taken when asked for,
 * not when the process happens to die.
 *
 * Also records how much CPU the process used, so the profile can be divided by a
 * known request count rather than eyeballed.
 *
 * It additionally reports the shutdown behaviour it observed, because "does the
 * service drain on SIGTERM" is a question that matters for a rolling deploy on
 * Kubernetes and is answered here rather than assumed.
 *
 * Usage:
 *   node --import tsx ops/profile/profiled-entry.mts <out.cpuprofile>
 */
import { writeFileSync } from 'node:fs';
import { Session } from 'node:inspector';
import { promisify } from 'node:util';

const outPath = process.argv[2];
if (!outPath) {
  console.error('usage: node --import tsx ops/profile/profiled-entry.mts <out.cpuprofile>');
  process.exit(1);
}

const session = new Session();
session.connect();

const post = promisify(
  (
    method: string,
    params?: object,
    callback: (err: Error | null, result?: object) => void,
  ) => session.post(method as never, params as never, callback as never),
).bind(session) as (method: string, params?: object) => Promise<object>;

let stopped = false;

async function writeProfile(): Promise<void> {
  if (stopped) return;
  stopped = true;
  try {
    const { profile } = (await post('Profiler.stop')) as { profile: object };
    writeFileSync(outPath, JSON.stringify(profile));
    console.error(`[profile] written: ${outPath}`);
  } catch (error) {
    // A missing profile must not be silent: it would look like a clean run.
    console.error('[profile] FAILED:', error instanceof Error ? error.message : String(error));
  }
}

// CPU used by this process, from /proc, summed over the tree. utime+stime are
// clock ticks at 100 Hz. The comm field is parenthesised and may contain spaces,
// so the line is split after the final ')'.
function cpuTicksTree(root: number): number {
  const children: number[] = [];
  try {
    for (const entry of require('node:fs').readdirSync('/proc')) {
      const pid = Number(entry);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      try {
        const stat = require('node:fs').readFileSync(`/proc/${pid}/stat`, 'utf8');
        const rest = stat.replace(/^\d+ \(.*\) /, '');
        const fields = rest.split(' ');
        if (Number(fields[1]) === root) children.push(pid);
      } catch {
        // The process exited between readdir and read; not interesting.
      }
    }
  } catch {
    // /proc unavailable. Reported as 0 rather than failing the run.
  }

  let total = 0;
  for (const pid of [root, ...children]) {
    try {
      const stat = require('node:fs').readFileSync(`/proc/${pid}/stat`, 'utf8');
      const rest = stat.replace(/^\d+ \(.*\) /, '');
      const fields = rest.split(' ');
      total += Number(fields[11]) + Number(fields[12]);
    } catch {
      // Exited already.
    }
    total += children.includes(pid) ? cpuTicksTree(pid) : 0;
  }
  return total;
}

const startedTicks = cpuTicksTree(process.pid);

await post('Profiler.enable');
await post('Profiler.setSamplingInterval', { interval: 200 });
await post('Profiler.start');

console.error('[profile] started');

// Records whether the service installs its own signal handling. A SIGTERM handler
// is what makes a rolling deploy drop nothing; its absence is worth surfacing on
// every run rather than discovering during a deploy.
const preexistingSigterm = process.listenerCount('SIGTERM');
const preexistingSigint = process.listenerCount('SIGINT');

let inFlightAtSignal = 0;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    inFlightAtSignal = process.getActiveResourcesInfo().filter(
      r => r === 'HTTPINCOMMESSHANDLER' || r === 'TCPSERVERWRAP',
    ).length;
    console.error(
      `[profile] ${signal}: gateway-installed handlers ` +
        `sigterm=${process.listenerCount('SIGTERM') - preexistingSigterm} ` +
        `sigint=${process.listenerCount('SIGINT') - preexistingSigint}; ` +
        `active server resources=${inFlightAtSignal}`,
    );
    void writeProfile().then(() => {
      const ticks = cpuTicksTree(process.pid) - startedTicks;
      console.error(`[profile] cpu_seconds=${(ticks / 100).toFixed(3)}`);
      process.exit(0);
    });
  });
}

await import('../../apps/gateway-api/src/index.js');
