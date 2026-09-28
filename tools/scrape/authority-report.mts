/**
 * Reports the road network by class, with the authority responsible for each, and
 * the authority hierarchy itself.
 *
 * The point of the report is routing: a complaint is only actionable if it reaches
 * the body that can fix the road, and in India that depends on the road's class.
 * Reporting kilometres without an owner makes the network look manageable when it
 * is actually several overlapping jurisdictions.
 *
 * Read-only. Usage: npx tsx tools/scrape/authority-report.mts
 */
import { readFileSync } from 'node:fs';
import { createPool } from '../../packages/core/src/postgres.js';
import {
  AGRA_AUTHORITIES,
  AUTHORITY_LEVELS,
  authorityLevelFor,
  buildAuthorityReport,
  escalateFrom,
  type AuthorityLevel,
} from './authorities.mjs';

function loadEnv(path: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    const k = t.slice(0, eq).trim().replace(/^export\s+/, '');
    if (env[k] === undefined) env[k] = v;
  }
  return env;
}

const DISTRICT = process.env.SCRAPE_DISTRICT ?? 'AGRA';
const env = loadEnv(new URL('../../.env', import.meta.url).pathname);
const { resolvePostgresEndpoint } = await import('../../packages/core/src/config/endpoints.js');
const endpoint = resolvePostgresEndpoint(env);

const pool = createPool(env, { max: 1, connectionTimeoutMillis: 30_000 });

try {
  console.log(
    `\ndatabase: ${endpoint.connectionString ? new URL(endpoint.connectionString).hostname : '?'}` +
      `  (tier=${endpoint.source})   district=${DISTRICT}`,
  );

  // ── Authority hierarchy ───────────────────────────────────────────────────
  console.log('\n=== authority hierarchy ===\n');
  for (const level of AUTHORITY_LEVELS) {
    const authority = AGRA_AUTHORITIES.find(a => a.level === level.level);
    console.log(`${level.label.toUpperCase()}  —  ${authority?.name ?? '(none registered)'}`);
    console.log(`  ${level.description}`);
    if (authority) {
      console.log(`  kind        : ${authority.kind}`);
      console.log(`  jurisdiction: ${authority.jurisdiction}`);
      for (const c of authority.officeContacts) {
        console.log(`  ${(c.label + ':').padEnd(13)}${c.value}`);
      }
    }
    const next = escalateFrom(level.level);
    console.log(`  escalates to: ${next ? AUTHORITY_LEVELS.find(l => l.level === next)?.label : '(top of chain)'}`);
    console.log('');
  }

  // ── Network by class, with owner ─────────────────────────────────────────
  const summary = await buildAuthorityReport(
    (sql, params) => pool.query(sql, params) as never,
    DISTRICT,
  );

  if (summary.length === 0) {
    console.log(`\nno roads loaded for district ${DISTRICT}. Run: npx tsx tools/scrape/import-roads.mts`);
    process.exit(0);
  }

  const totalRoads = summary.reduce((n, r) => n + r.roads, 0);
  const totalKm = summary.reduce((n, r) => n + r.total_km, 0);
  const totalNamed = summary.reduce((n, r) => n + r.named, 0);

  console.log('=== network by road class, with responsible authority ===\n');
  const w = (s: string, n: number): string => s.padEnd(n);
  console.log(
    w('ROAD TYPE', 14) + w('AUTHORITY', 26) + w('LEVEL', 11) +
    w('ROADS', 8) + w('KM', 10) + w('NAMED', 8) + 'NAMED %',
  );
  console.log('-'.repeat(92));
  for (const r of summary) {
    const namedPct = r.roads > 0 ? (r.named / r.roads) * 100 : 0;
    console.log(
      w(r.road_type, 14) +
        w(r.authority_name.length > 24 ? r.authority_name.slice(0, 24) + '…' : r.authority_name, 26) +
        w(r.authority_level, 11) +
        w(r.roads.toLocaleString(), 8) +
        w(r.total_km.toFixed(0), 10) +
        w(r.named.toLocaleString(), 8) +
        `${namedPct.toFixed(1)}%`,
    );
  }
  console.log('-'.repeat(92));
  console.log(
    w('TOTAL', 14) + w('', 26) + w('', 11) +
      w(totalRoads.toLocaleString(), 8) + w(totalKm.toFixed(0), 10) +
      w(totalNamed.toLocaleString(), 8) +
      `${((totalNamed / totalRoads) * 100).toFixed(1)}%`,
  );

  // ── Where the work is, by owner ──────────────────────────────────────────
  console.log('\n=== who owns how much ===\n');
  const byAuthority = new Map<AuthorityLevel, { roads: number; km: number }>();
  for (const r of summary) {
    const entry = byAuthority.get(r.authority_level) ?? { roads: 0, km: 0 };
    entry.roads += r.roads;
    entry.km += r.total_km;
    byAuthority.set(r.authority_level, entry);
  }
  for (const level of AUTHORITY_LEVELS) {
    const e = byAuthority.get(level.level);
    if (!e) continue;
    const pctKm = (e.km / totalKm) * 100;
    const pctRoads = (e.roads / totalRoads) * 100;
    const bar = '#'.repeat(Math.max(1, Math.round(pctKm / 2)));
    console.log(
      `${w(level.label, 12)}${e.km.toFixed(0).padStart(6)} km  ` +
        `${pctKm.toFixed(1).padStart(5)}%  ${w(e.roads.toLocaleString() + ' roads', 14)} ` +
        `${pctRoads.toFixed(1).padStart(5)}%  ${bar}`,
    );
  }

  // ── Routing table ────────────────────────────────────────────────────────
  console.log('\n=== routing: road type -> authority level ===\n');
  for (const level of AUTHORITY_LEVELS) {
    const types = summary.filter(r => r.authority_level === level.level).map(r => r.road_type);
    if (types.length === 0) continue;
    console.log(`  ${level.label.toLowerCase().padEnd(11)} <- ${types.join(', ')}`);
  }

  // ── The data-quality problem, stated plainly ─────────────────────────────
  console.log('\n=== named coverage ===\n');
  const namedPct = (totalNamed / totalRoads) * 100;
  console.log(
    `  ${totalNamed.toLocaleString()} of ${totalRoads.toLocaleString()} roads carry a name ` +
      `(${namedPct.toFixed(1)}%).`,
  );
  const unnamedKm = summary
    .filter(r => r.roads > 0)
    .map(r => ({ t: r.road_type, km: r.total_km, named: r.named, roads: r.roads }))
    .filter(r => r.named === 0)
    .sort((a, b) => b.km - a.km);
  if (unnamedKm.length > 0) {
    console.log('  Classes with no named road at all:');
    for (const u of unnamedKm) console.log(`    ${u.t.padEnd(14)} ${u.km.toFixed(0).padStart(6)} km`);
  }
  console.log(
    '\n  This is the binding constraint on the platform, not the authority mapping: a\n' +
      '  citizen cannot report "a pothole on <unnamed road>" if neither they nor the\n' +
      '  system can identify the road. The two options are to accept coordinates as\n' +
      '  the primary identifier and show a nearby named road as a hint, or to\n' +
      '  supplement OSM with the municipal street register.',
  );
} catch (error) {
  console.error(`\nFAIL  ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}
