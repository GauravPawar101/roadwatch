/**
 * Database Migration Runner
 * Executes SQL migrations in order for image submission system setup
 */

import * as fs from 'fs';
import * as path from 'path';
import { Pool } from './cassandra-adapter';

export async function runMigrations(pool: Pool, migrationsDir: string): Promise<void> {
  console.log('🚀 Starting database migrations...');

  // Read CQL migration files (use .cql for Cassandra)
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.cql'));

  if (files.length === 0) {
    console.warn('⚠️  No migration files found');
    return;
  }

  // Sort by filename (001_, 002_, etc.)
  files.sort();

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf-8');

    try {
      console.log(`📝 Running migration: ${file}`);
      // Execute CQL via the adapter (expects CQL statements)
      await pool.query(sql);
      console.log(`✅ Completed: ${file}`);
    } catch (err) {
      console.error(`❌ Failed: ${file}`);
      console.error(err);
      throw err;
    }
  }

  console.log('🎉 All migrations completed successfully!');
}

/**
 * Setup function for local development
 */
export async function setupDevelopmentDatabase(): Promise<void> {
  const pool = new Pool();

  try {
    // Test connection
    await pool.query('SELECT release_version FROM system.local');
    console.log('✅ Cassandra connection successful');

    // Run CQL migrations
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    await runMigrations(pool, migrationsDir);

    // Seed initial data
    await seedInitialData(pool);
  } finally {
    await pool.end();
  }
}

/**
 * Seed initial data (optional)
 */
async function seedInitialData(pool: Pool): Promise<void> {
  console.log('🌱 Seeding initial data...');

  // Create admin user profile
  const now = new Date();
  const stmt = `INSERT INTO user_privacy_profiles (user_id, is_admin, is_authority, is_contractor, is_citizen, can_view_user_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) IF NOT EXISTS`;
  await pool.query(stmt, ['admin-system', true, false, false, false, true, now, now]);
  console.log('✅ Admin profile seeded');
}

// Run if executed directly
if (require.main === module) {
  setupDevelopmentDatabase().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
