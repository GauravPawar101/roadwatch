/**
 * Database Migration Runner
 * Executes SQL migrations in order for image submission system setup
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { pool } from './postgres.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(migrationsDir: string): Promise<void> {
  console.log('Starting database migrations...');

  // Updated to read standard .sql migration files instead of Cassandra .cql files
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));

  if (files.length === 0) {
    console.warn('No migration files found');
    return;
  }

  // Sort by filename (001_, 002_, etc.)
  files.sort();

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const rawSql = fs.readFileSync(filePath, 'utf-8');

    try {
      console.log(`Running migration: ${file}`);
      
      await pool.query(rawSql);
      
      console.log(`Completed: ${file}`);
    } catch (err) {
      console.error(`Failed: ${file}`);
      console.error(err);
      throw err;
    }
  }

  console.log('All migrations completed successfully!');
}

/**
 * Setup function for local development
 */
export async function setupDevelopmentDatabase(): Promise<void> {
  try {
    // Test connection using standard Postgres version lookup instead of Cassandra system keyspaces
    await pool.query('SELECT version()');
    console.log('PostgreSQL connection successful');

    // Run SQL migrations
    const migrationsDir = path.join(__dirname, '..', 'migrations');
    await runMigrations(migrationsDir);

    // Seed initial data
    await seedInitialData();
  } catch (err) {
    console.error('Database initialization failed:', err);
    throw err;
  }
}

/**
 * Seed initial data
 */
async function seedInitialData(): Promise<void> {
  console.log('Seeding initial data...');

  const userId = 'admin-system';
  
  await pool.query(
    `INSERT INTO user_privacy_profiles (
       user_id, is_admin, is_authority, is_contractor, is_citizen, can_view_user_ids, created_at, updated_at
     ) VALUES (
       $1, true, false, false, false, $2, NOW(), NOW()
     )
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, null]
  );

  console.log('Seeding completed.');
}