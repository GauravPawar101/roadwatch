import { GeoCoordinate } from './GeoCoordinate';
import { isValidPinCode } from './Validators';

export class Road {
  private constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly pinCode: string,
    public readonly startPoint: GeoCoordinate,
    public readonly endPoint: GeoCoordinate,
    public readonly authorityId: string
  ) {}

  public static create(
    id: string,
    name: string,
    pinCode: string,
    startPoint: GeoCoordinate,
    endPoint: GeoCoordinate,
    authorityId: string
  ): Road {
    if (!id.trim() || !name.trim() || !authorityId.trim()) {
      throw new Error("Road ID, Name, and Authority ID cannot be empty.");
    }

    if (!isValidPinCode(pinCode)) {
      throw new Error(`Invalid Indian PIN code for road: ${pinCode}`);
    }

    return new Road(id, name, pinCode, startPoint, endPoint, authorityId);
  }
}
