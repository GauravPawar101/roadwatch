#!/usr/bin/env node
const path = require('path');
const { migrate } = require('./worker');
const mappings = require('./mappings');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { dryRun: false, batchSize: 500, tables: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--batch') out.batchSize = Number(args[++i] || out.batchSize);
    else if (a === '--tables') out.tables = (args[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '-h' || a === '--help') {
      console.log('Usage: node scripts/migrate/index.js [--dry-run] [--batch 500] [--tables users,complaints]');
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  const cfg = parseArgs();
  const selected = cfg.tables ? mappings.filter(m => cfg.tables.includes(m.name)) : mappings;
  if (selected.length === 0) {
    console.error('No mappings matched tables:', cfg.tables);
    process.exit(2);
  }

  console.log('Starting migration. Tables:', selected.map(s => s.name).join(', '), 'dryRun=', cfg.dryRun, 'batchSize=', cfg.batchSize);
  try {
    await migrate({ mappings: selected, dryRun: cfg.dryRun, batchSize: cfg.batchSize });
    console.log('Migration finished');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

if (require.main === module) main();
