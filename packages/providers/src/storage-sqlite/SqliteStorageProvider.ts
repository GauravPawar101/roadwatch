import { Complaint, ComplaintStatus } from '@roadwatch/core/src/domain/Complaint';
import { GeoCoordinate } from '@roadwatch/core/src/domain/GeoCoordinate';
import type { IStorageProvider } from '@roadwatch/core/src/interfaces/IStorageProvider';

// Mocked SQLite bindings interface
interface SQLiteDB {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: any[]): Promise<void>;
  get(sql: string, params?: any[]): Promise<any>;
  all(sql: string, params?: any[]): Promise<any[]>;
}

export class SqliteStorageProvider implements IStorageProvider {
  private db: SQLiteDB;

  /**
   * Dependency Injection: 
   * Injecting the SQLite database connection directly allows easy testing 
   * and swapping between in-memory or solid-state DBs.
   */
  constructor(dbConnection: SQLiteDB) {
    this.db = dbConnection;
  }

  async initializeSchema(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS complaints (
        id TEXT PRIMARY KEY,
        road_id TEXT,
        author_id TEXT,
        description TEXT,
        lat REAL,
        lng REAL,
        timestamp INTEGER,
        status TEXT,
        image_hashes TEXT,
        synced INTEGER DEFAULT 0
      )
    `);
    console.log("SQLite schema initialized successfully.");
  }

  async migrateSchema(currentVersion: number, targetVersion: number): Promise<void> {
    console.log(`Migrating SQLite schema from version ${currentVersion} to ${targetVersion}`);
    
    try {
      // Define migration steps
      const migrations: { [version: number]: () => Promise<void> } = {
        1: async () => {
          // Initial schema - already handled in initializeSchema
          console.log('Migration v1: Initial schema already exists');
        },
        
        2: async () => {
          // Add priority and category columns
          await this.db.exec(`
            ALTER TABLE complaints ADD COLUMN priority TEXT DEFAULT 'MEDIUM';
            ALTER TABLE complaints ADD COLUMN category TEXT DEFAULT 'ROAD_DAMAGE';
          `);
          console.log('Migration v2: Added priority and category columns');
        },
        
        3: async () => {
          // Add media URLs and metadata columns
          await this.db.exec(`
            ALTER TABLE complaints ADD COLUMN media_urls TEXT DEFAULT '[]';
            ALTER TABLE complaints ADD COLUMN metadata TEXT DEFAULT '{}';
            ALTER TABLE complaints ADD COLUMN created_at INTEGER DEFAULT 0;
            ALTER TABLE complaints ADD COLUMN updated_at INTEGER DEFAULT 0;
          `);
          console.log('Migration v3: Added media URLs and metadata columns');
        },
        
        4: async () => {
          // Add escalation tracking
          await this.db.exec(`
            ALTER TABLE complaints ADD COLUMN escalation_level INTEGER DEFAULT 0;
            ALTER TABLE complaints ADD COLUMN assigned_authority_id TEXT;
            ALTER TABLE complaints ADD COLUMN last_escalated_at INTEGER DEFAULT 0;
          `);
          console.log('Migration v4: Added escalation tracking columns');
        },
        
        5: async () => {
          // Create roads table for better road management
          await this.db.exec(`
            CREATE TABLE IF NOT EXISTS roads (
              id TEXT PRIMARY KEY,
              name TEXT,
              type TEXT,
              coordinates TEXT,
              district TEXT,
              state TEXT,
              condition_score INTEGER DEFAULT 50,
              last_inspected_at INTEGER DEFAULT 0,
              created_at INTEGER DEFAULT 0,
              updated_at INTEGER DEFAULT 0
            );
          `);
          console.log('Migration v5: Created roads table');
        },
        
        6: async () => {
          // Create authorities table
          await this.db.exec(`
            CREATE TABLE IF NOT EXISTS authorities (
              id TEXT PRIMARY KEY,
              name TEXT,
              type TEXT,
              jurisdiction TEXT,
              contact_info TEXT,
              active INTEGER DEFAULT 1,
              created_at INTEGER DEFAULT 0,
              updated_at INTEGER DEFAULT 0
            );
          `);
          console.log('Migration v6: Created authorities table');
        },
        
        7: async () => {
          // Create escalation_history table
          await this.db.exec(`
            CREATE TABLE IF NOT EXISTS escalation_history (
              id TEXT PRIMARY KEY,
              complaint_id TEXT,
              from_authority_id TEXT,
              to_authority_id TEXT,
              tier TEXT,
              reason TEXT,
              escalated_at INTEGER,
              delivery_status TEXT DEFAULT 'SENT',
              fabric_tx_id TEXT,
              auto_generated INTEGER DEFAULT 0,
              FOREIGN KEY (complaint_id) REFERENCES complaints (id)
            );
          `);
          console.log('Migration v7: Created escalation_history table');
        },
        
        8: async () => {
          // Add indexes for better query performance
          await this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_complaints_road_id ON complaints (road_id);
            CREATE INDEX IF NOT EXISTS idx_complaints_author_id ON complaints (author_id);
            CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints (status);
            CREATE INDEX IF NOT EXISTS idx_complaints_timestamp ON complaints (timestamp);
            CREATE INDEX IF NOT EXISTS idx_complaints_synced ON complaints (synced);
            CREATE INDEX IF NOT EXISTS idx_complaints_location ON complaints (lat, lng);
            CREATE INDEX IF NOT EXISTS idx_escalation_complaint_id ON escalation_history (complaint_id);
            CREATE INDEX IF NOT EXISTS idx_roads_type ON roads (type);
            CREATE INDEX IF NOT EXISTS idx_authorities_type ON authorities (type);
          `);
          console.log('Migration v8: Added performance indexes');
        },
        
        9: async () => {
          // Add full-text search support
          await this.db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS complaints_fts USING fts5(
              id UNINDEXED,
              description,
              category,
              content='complaints',
              content_rowid='rowid'
            );
            
            -- Populate FTS table with existing data
            INSERT INTO complaints_fts(id, description, category)
            SELECT id, description, COALESCE(category, 'ROAD_DAMAGE') FROM complaints;
            
            -- Create triggers to keep FTS in sync
            CREATE TRIGGER IF NOT EXISTS complaints_fts_insert AFTER INSERT ON complaints BEGIN
              INSERT INTO complaints_fts(id, description, category) 
              VALUES (new.id, new.description, COALESCE(new.category, 'ROAD_DAMAGE'));
            END;
            
            CREATE TRIGGER IF NOT EXISTS complaints_fts_update AFTER UPDATE ON complaints BEGIN
              UPDATE complaints_fts SET description = new.description, category = COALESCE(new.category, 'ROAD_DAMAGE')
              WHERE id = new.id;
            END;
            
            CREATE TRIGGER IF NOT EXISTS complaints_fts_delete AFTER DELETE ON complaints BEGIN
              DELETE FROM complaints_fts WHERE id = old.id;
            END;
          `);
          console.log('Migration v9: Added full-text search support');
        },
        
        10: async () => {
          // Add audit trail table
          await this.db.exec(`
            CREATE TABLE IF NOT EXISTS audit_trail (
              id TEXT PRIMARY KEY,
              entity_type TEXT,
              entity_id TEXT,
              action TEXT,
              old_values TEXT,
              new_values TEXT,
              user_id TEXT,
              timestamp INTEGER,
              ip_address TEXT,
              user_agent TEXT
            );
            
            CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_trail (entity_type, entity_id);
            CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_trail (timestamp);
            CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_trail (user_id);
          `);
          console.log('Migration v10: Added audit trail table');
        }
      };
      
      // Execute migrations sequentially from current to target version
      for (let version = currentVersion + 1; version <= targetVersion; version++) {
        const migr = migrations[version];
        if (migr) {
          console.log(`Executing migration to version ${version}...`);
          await migr();
          
          // Update schema version in a metadata table
          await this.updateSchemaVersion(version);
        } else {
          console.warn(`No migration defined for version ${version}`);
        }
      }
      
      console.log(`Schema migration completed successfully. Current version: ${targetVersion}`);
      
    } catch (error) {
      console.error('Schema migration failed:', error);
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to migrate schema from ${currentVersion} to ${targetVersion}: ${msg}`);
    }
  }
  
  private async updateSchemaVersion(version: number): Promise<void> {
    // Create metadata table if it doesn't exist
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER
      );
    `);
    
    // Update schema version
    await this.db.run(`
      INSERT OR REPLACE INTO schema_metadata (key, value, updated_at)
      VALUES ('schema_version', ?, ?)
    `, [version.toString(), Date.now()]);
  }
  
  async getCurrentSchemaVersion(): Promise<number> {
    try {
      const result = await this.db.get(`
        SELECT value FROM schema_metadata WHERE key = 'schema_version'
      `);
      return result ? parseInt(result.value, 10) : 0;
    } catch (error) {
      // If metadata table doesn't exist, assume version 0
      return 0;
    }
  }

  async createComplaint(complaint: Complaint): Promise<void> {
    // Offline-first approach: save everything locally first with 'synced' = 0
    // A background sync worker can later pick up these records and sync them.
    const location = complaint.location;
    await this.db.run(`
      INSERT INTO complaints (id, road_id, author_id, description, lat, lng, timestamp, status, image_hashes, synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `, [
      complaint.id, 
      complaint.roadId, 
      complaint.authorId, 
      complaint.description,
      location.latitude, 
      location.longitude, 
      complaint.timestamp, 
      complaint.status,
      JSON.stringify(complaint.imageHashes)
    ]);
  }

  async getComplaint(id: string): Promise<Complaint | null> {
    const row = await this.db.get(`SELECT * FROM complaints WHERE id = ?`, [id]);
    if (!row) return null;
    
    const baseComplaint = Complaint.create(
      row.id,
      row.road_id,
      row.author_id,
      row.description,
      GeoCoordinate.create(row.lat, row.lng),
      JSON.parse(row.image_hashes)
    );
    
    return baseComplaint.updateStatus(row.status as ComplaintStatus);
  }

  async updateComplaint(complaint: Complaint): Promise<void> {
    // Set synced = 0 anytime there's a local mutation
    const location = complaint.location;
    await this.db.run(`
      UPDATE complaints 
      SET description = ?, lat = ?, lng = ?, status = ?, image_hashes = ?, synced = 0
      WHERE id = ?
    `, [
      complaint.description, 
      location.latitude, 
      location.longitude, 
      complaint.status, 
      JSON.stringify(complaint.imageHashes), 
      complaint.id
    ]);
  }

  async deleteComplaint(id: string): Promise<void> {
    await this.db.run(`DELETE FROM complaints WHERE id = ?`, [id]);
  }

  async getAllComplaints(): Promise<Complaint[]> {
    const rows = await this.db.all(`SELECT * FROM complaints`);
    return rows.map((row: any) => 
      Complaint.create(
        row.id, 
        row.road_id, 
        row.author_id, 
        row.description,
        GeoCoordinate.create(row.lat, row.lng), 
        JSON.parse(row.image_hashes)
      ).updateStatus(row.status as ComplaintStatus)
    );
  }
}
