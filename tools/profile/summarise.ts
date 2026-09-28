/**
 * Summarises a V8 `.cpuprofile` into a ranked table of where CPU time went.
 *
 * Two things make this more than a file dump:
 *
 * 1. It aggregates self time across every sample and every id, not just one
 *    node id, so a function that was inlined or re-created mid-run is not split
 *    across several entries.
 * 2. It attributes by *category* as well as by function, because the useful
 *    question is not "which function is hot" but "how much of this is my code
 *    versus JSON parsing versus the database driver versus garbage collection".
 *    That split is what decides whether the next hour goes into the handler or
 *    into removing work from the request.
 *
 * Usage: npx tsx tools/profile/summarise.ts <file.cpuprofile> [--top 40]
 */
import { readFileSync } from 'node:fs';

interface Node {
  id: number;
  callFrame: {
    functionName: string;
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
  children?: number[];
}

interface Profile {
  nodes: Node[];
  samples?: number[];
  timeDeltas?: number[];
}

const path = process.argv[2];
if (!path) {
  console.error('usage: npx tsx tools/profile/summarise.ts <file.cpuprofile> [--top N]');
  process.exit(1);
}
const topN = Number(process.argv[process.argv.indexOf('--top') + 1]) || 40;

const profile = JSON.parse(readFileSync(path, 'utf8')) as Profile;
const { nodes, samples = [], timeDeltas = [] } = profile;

/** nodeId -> (usec of self time) */
const selfByNode = new Map<number, number>();
for (let i = 0; i < samples.length; i += 1) {
  const id = samples[i]!;
  const delta = timeDeltas[i] ?? 0;
  selfByNode.set(id, (selfByNode.get(id) ?? 0) + delta);
}

/** Collapses file paths so the table is readable and stable. */
function shortUrl(url: string): string {
  if (!url) return '(native)';
  if (url.startsWith('node:')) return url;
  const marker = url.lastIndexOf('/roadwatch/');
  if (marker !== -1) return url.slice(marker + '/roadwatch/'.length);
  const segments = url.split('/');
  return segments.slice(-2).join('/');
}

function categoryFor(url: string, fn: string): string {
  if (/node_modules[/\\]pg-/.test(url) || /\bpg\b/.test(url)) return 'postgres driver (pg)';
  if (/node_modules[/\\]ioredis/.test(url)) return 'redis client (ioredis)';
  if (/node_modules[/\\]kafkajs/.test(url)) return 'kafka client (kafkajs)';
  if (/node_modules[/\\]json2mqtt|node_modules[/\\]express/.test(url)) return 'http framework';
  if (/node_modules[/\\]crypto|node:internal[/\\]crypto/.test(url)) return 'crypto / jwt';
  if (/node_modules/.test(url)) {
    const pkg = url.split('node_modules/')[1]?.split('/')[0] ?? '';
    return `dependency: ${pkg.replace(/^@[^/]+\//, '@')}`;
  }
  if (fn === '(garbage collector)') return 'garbage collection';
  if (fn === '(program)' || fn === '(idle)' || fn === '(root)') return 'runtime / idle';
  if (!url) return 'native / internal';
  return 'application code';
}

const byFunction = new Map<string, number>();
const byCategory = new Map<string, number>();
let total = 0;

for (const [id, usec] of selfByNode) {
  const node = nodes.find(n => n.id === id);
  if (!node) continue;
  total += usec;

  const { functionName, url } = node.callFrame;
  const label = functionName || '(anonymous)';
  const key = `${label} @ ${shortUrl(url)}:${node.callFrame.lineNumber + 1}`;
  byFunction.set(key, (byFunction.get(key) ?? 0) + usec);

  const cat = categoryFor(url, label);
  byCategory.set(cat, (byCategory.get(cat) ?? 0) + usec);
}

const ms = (usec: number): string => `${(usec / 1000).toFixed(0).padStart(7)} ms`;
const pct = (usec: number): string => `${((usec / total) * 100).toFixed(1).padStart(5)}%`;

console.log(`profile : ${path}`);
console.log(`samples : ${samples.length}`);
console.log(`sampled : ${(total / 1000).toFixed(0)} ms of CPU\n`);

console.log('=== by category ===');
for (const [cat, usec] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${ms(usec)}  ${pct(usec)}  ${cat}`);
}

console.log(`\n=== top ${topN} functions by self time ===`);
for (const [fn, usec] of [...byFunction.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)) {
  console.log(`${ms(usec)}  ${pct(usec)}  ${fn}`);
}
