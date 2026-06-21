import { DB_COMPLAINT_STATUS } from './Enums.js';
import { GeoCoordinate } from './GeoCoordinate.js';

export class Complaint {
  private constructor(
    public readonly id: string,
    public readonly roadId: string,
    public readonly authorId: string,
    public readonly description: string,
    public readonly location: GeoCoordinate,
    public readonly timestamp: number,
    public readonly status: string,
    public readonly imageHashes: string[]
  ) {}

  public static create(
    id: string,
    roadId: string,
    authorId: string,
    description: string,
    location: GeoCoordinate,
    imageHashes: string[] = []
  ): Complaint {
    if (!id.trim() || !roadId.trim() || !authorId.trim()) {
      throw new Error('Complaint ID, Road ID, and Author ID cannot be empty.');
    }

    if (!description.trim() || description.length < 10) {
      throw new Error('Complaint description must be at least 10 characters long.');
    }

    if (imageHashes.length > 5) {
      throw new Error('A road quality complaint can have a maximum of 5 images attached.');
    }

    return new Complaint(
      id,
      roadId,
      authorId,
      description,
      location,
      Date.now(),
      DB_COMPLAINT_STATUS.FILED,
      imageHashes
    );
  }

  public updateStatus(newStatus: string): Complaint {
    return new Complaint(
      this.id,
      this.roadId,
      this.authorId,
      this.description,
      this.location,
      this.timestamp,
      newStatus,
      this.imageHashes
    );
  }
}
