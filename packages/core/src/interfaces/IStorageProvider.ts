import type { Complaint } from '../domain/Complaint';

export interface IStorageProvider {
  /**
   * Initializes the local database schema.
   */
  initializeSchema(): Promise<void>;

  /**
   * Runs local database migrations to reach the target schema version.
   */
  migrateSchema(currentVersion: number, targetVersion: number): Promise<void>;

  /**
   * Persists a new Complaint.
   */
  createComplaint(complaint: Complaint): Promise<void>;

  /**
   * Retrieves a Complaint by its unique ID.
   */
  getComplaint(id: string): Promise<Complaint | null>;

  /**
   * Updates an existing Complaint.
   */
  updateComplaint(complaint: Complaint): Promise<void>;

  /**
   * Deletes a Complaint by its unique ID.
   */
  deleteComplaint(id: string): Promise<void>;

  /**
   * Retrieves all Complaints currently stored.
   */
  getAllComplaints(): Promise<Complaint[]>;
}
