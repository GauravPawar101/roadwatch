/**
 * Length distribution of the cached OSM network.
 *
 * Exists to settle a threshold with data rather than by intuition: the first
 * minimum-length filter of 40 m dropped 29% of Agra's ways, and in a dense old
 * city a 30 m lane is a normal, complaint-worthy road rather than a stub. The
 * percentile table makes the choice reviewable instead of arbitrary.
 */
import { readFileSync } from 'node:fs';
import { isRoutableRoad, lengthKm } from './osm-map.mjs';

const cachePath = process.argv[2] ??
  '/home/Gaurav/Desktop/roadwatch/data/osm/agra-roads-26.85_77.5_27.35_78.05.json';

const cache = JSON.parse(readFileSync(cachePath, 'utf8')) as {
  ways: Array<{ geometry?: Array<{ lat: number; lon: number }> }>;
};

const lengths: number[] = [];
for (const way of cache.ways) {
  if (!isRoutableRoad(way)) continue;
  if (!way.geometry || way.geometry.length < 2) continue;
  lengths.push(lengthKm(way.geometry.map(n => [n.lon, n.lat] as [number, number])));
}
lengths.sort((a, b) => a - b);

const at = (p: number): number => lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * p))] ?? 0;

console.log(`routable ways with geometry : ${lengths.length}`);
console.log(`total length                : ${lengths.reduce((a, b) => a + b, 0).toFixed(0)} km\n`);
console.log('percentiles (km):');
for (const p of [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
  console.log(`  p${String(Math.round(p * 100)).padStart(2)}  ${at(p).toFixed(4)}`);
}
console.log(`  min   ${(lengths[0] ?? 0).toFixed(5)}`);
console.log(`  max   ${(lengths[lengths.length - 1] ?? 0).toFixed(3)}\n`);

console.log('ways below each candidate minimum:');
for (const metres of [5, 8, 10, 15, 20, 30, 40]) {
  const below = lengths.filter(l => l * 1000 < metres).length;
  console.log(
    `  ${String(metres).padStart(3)}m  ${String(below).padStart(6)}  ` +
      `(${(below / lengths.length * 100).toFixed(1)}%)`,
  );
}
