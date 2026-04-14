import type { Complaint, GeoLocation, Road } from '@roadwatch/core/src/domain/Entities';
import type { ILocalStore } from '@roadwatch/core/src/interfaces/storage/StorageInterfaces';

export class MockLocalStore implements ILocalStore {
  private readonly complaints = new Map<string, Complaint>();
  private readonly roads = new Map<string, Road>();
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async saveComplaint(complaint: Complaint): Promise<void> {
    this.assertInitialized();
    this.complaints.set(complaint.id, complaint);
  }

  async getComplaint(id: string): Promise<Complaint | null> {
    this.assertInitialized();
    return this.complaints.get(id) ?? null;
  }

  async queryComplaints(_boundingBox?: { topLeft: GeoLocation; bottomRight: GeoLocation }): Promise<Complaint[]> {
    this.assertInitialized();
    // Bounding box filtering can be added if/when engines depend on it.
    return [...this.complaints.values()];
  }

  async saveRoad(road: Road): Promise<void> {
    this.assertInitialized();
    this.roads.set(road.id, road);
  }

  getRoad(id: string): Road | null {
    return this.roads.get(id) ?? null;
  }

  clear(): void {
    this.complaints.clear();
    this.roads.clear();
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error('MockLocalStore not initialized. Call initialize() first.');
    }
  }
}
