import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

export class SQLiteLocalStore {
  private db: any | null = null;
  private dbPath: string;

  constructor(dbPath: string = ':memory:') {
    this.dbPath = dbPath;
  }

  private async getDb(): Promise<any> {
    if (!this.db) {
      this.db = await open({
        filename: this.dbPath,
        driver: sqlite3.Database
      });
      
      // Initialize the key-value table
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS kv_store (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
    }
    return this.db;
  }
  
  async save(key: string, data: any): Promise<void> {
    console.log(`[SQLiteLocalStore] Saving data for key: ${key}`);
    const db = await this.getDb();
    const serializedData = JSON.stringify(data);
    
    await db.run(
      `INSERT OR REPLACE INTO kv_store (key, value, updated_at) 
       VALUES (?, ?, CURRENT_TIMESTAMP)`,
      [key, serializedData]
    );
  }
  
  async load(key: string): Promise<any> {
    console.log(`[SQLiteLocalStore] Loading data for key: ${key}`);
    const db = await this.getDb();
    
    const row = await db.get(
      `SELECT value FROM kv_store WHERE key = ?`,
      [key]
    );
    
    if (!row) {
      return null;
    }
    
    try {
      return JSON.parse(row.value);
    } catch (error) {
      console.error(`[SQLiteLocalStore] Failed to parse data for key ${key}:`, error);
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    console.log(`[SQLiteLocalStore] Deleting data for key: ${key}`);
    const db = await this.getDb();
    
    await db.run(
      `DELETE FROM kv_store WHERE key = ?`,
      [key]
    );
  }

  async list(prefix?: string): Promise<string[]> {
    console.log(`[SQLiteLocalStore] Listing keys with prefix: ${prefix || 'all'}`);
    const db = await this.getDb();
    
    let query = `SELECT key FROM kv_store`;
    const params: string[] = [];
    
    if (prefix) {
      query += ` WHERE key LIKE ?`;
      params.push(`${prefix}%`);
    }
    
    query += ` ORDER BY key`;
    
    const rows = await db.all(query, params);
    return rows.map((row: any) => row.key);
  }

  async clear(): Promise<void> {
    console.log(`[SQLiteLocalStore] Clearing all data`);
    const db = await this.getDb();
    await db.run(`DELETE FROM kv_store`);
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }
}
