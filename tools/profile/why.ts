/**
 * Finds the call paths leading to a named function in a `.cpuprofile`.
 *
 * A flat self-time table says `createPublicKey` is 4.5% of CPU but not who calls
 * it, and the dependency source is not obvious — `jws` does not use
 * `createPublicKey` for an HMAC secret, so the caller is in application or
 * framework code. This walks the profile's parent links and prints the chain, with
 * each frame's self time, so the caller is identified rather than guessed.
 *
 * Usage: npx tsx tools/profile/why.ts <file.cpuprofile> <functionName>
 */
import { readFileSync } from 'node:fs';

const path = process.argv[2];
const needle = (process.argv[3] ?? '').toLowerCase();
if (!path || !needle) {
  console.error('usage: npx tsx tools/profile/why.ts <file.cpuprofile> <functionName>');
  process.exit(1);
}

interface Node {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  children?: number[];
}
interface Profile {
  nodes: Node[];
  samples?: number[];
  timeDeltas?: number[];
}

const profile = JSON.parse(readFileSync(path, 'utf8')) as Profile;
const byId = new Map(profile.nodes.map(n => [n.id, n]));
const parentOf = new Map<number, number>();
for (const node of profile.nodes) {
  for (const child of node.children ?? []) parentOf.set(child, node.id);
}

const selfByNode = new Map<number, number>();
for (let i = 0; i < (profile.samples ?? []).length; i += 1) {
  const id = profile.samples![i]!;
  selfByNode.set(id, (selfByNode.get(id) ?? 0) + (profile.timeDeltas?.[i] ?? 0));
}

function label(node: Node): string {
  const url = node.callFrame.url || '(native)';
  const short = url.includes('/roadwatch/')
    ? url.slice(url.indexOf('/roadwatch/') + '/roadwatch/'.length)
    : url.replace(/^node:/, 'node:');
  return `${node.callFrame.functionName || '(anonymous)'} @ ${short}:${node.callFrame.lineNumber + 1}`;
}

const matches = profile.nodes.filter(n =>
  n.callFrame.functionName.toLowerCase().includes(needle),
);

if (matches.length === 0) {
  console.log(`no node matches "${needle}"`);
  process.exit(0);
}

// Grouped by unique call path, so one path with many nodes does not drown out
// the others.
const byPath = new Map<string, { self: number; nodes: number }>();
for (const node of matches) {
  const chain: Node[] = [];
  let cursor: Node | undefined = node;
  for (let depth = 0; cursor && depth < 40; depth += 1) {
    chain.unshift(cursor);
    const parent = parentOf.get(cursor.id);
    cursor = parent !== undefined ? byId.get(parent) : undefined;
  }
  const key = chain.map(label).join('\n    <- ');
  const entry = byPath.get(key) ?? { self: 0, nodes: 0 };
  entry.self += selfByNode.get(node.id) ?? 0;
  entry.nodes += 1;
  byPath.set(key, entry);
}

const ranked = [...byPath.entries()].sort((a, b) => b[1].self - a[1].self).slice(0, 5);
const total = ranked.reduce((sum, [, v]) => sum + v.self, 0);

console.log(`"${needle}": ${matches.length} node(s), ${(total / 1000).toFixed(0)} ms self time\n`);
for (const [path, v] of ranked) {
  console.log(`--- ${(v.self / 1000).toFixed(0)} ms across ${v.nodes} node(s) ---`);
  console.log(`    ${path}\n`);
}
