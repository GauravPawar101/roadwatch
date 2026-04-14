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
    // Migration logic placeholder
    console.log(`Migrating SQLite schema from ${currentVersion} to ${targetVersion}`);
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
