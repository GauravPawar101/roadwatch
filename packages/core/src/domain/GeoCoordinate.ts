import { isWithinIndia } from './Validators';

export class GeoCoordinate {
  private constructor(
    public readonly latitude: number,
    public readonly longitude: number
  ) {}

  public static create(latitude: number, longitude: number): GeoCoordinate {
    if (!isWithinIndia(latitude, longitude)) {
      throw new Error(`Coordinates [${latitude}, ${longitude}] fall outside India bounding box.`);
    }
    return new GeoCoordinate(latitude, longitude);
  }
}
