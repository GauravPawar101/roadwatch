import { isValidPinCode } from './Validators';

export enum AuthorityType {
  Municipal = 'Municipal',
  State = 'State',
  NHAI = 'NHAI',
}

export class Authority {
  private constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly type: AuthorityType,
    public readonly jurisdictionPinCodes: string[]
  ) {}

  public static create(
    id: string,
    name: string,
    type: AuthorityType,
    jurisdictionPinCodes: string[]
  ): Authority {
    if (!id.trim() || !name.trim()) {
      throw new Error("Authority ID and Name cannot be empty.");
    }
    
    // Ensure all PIN codes are valid.
    const invalidPins = jurisdictionPinCodes.filter(pin => !isValidPinCode(pin));
    if (invalidPins.length > 0) {
      throw new Error(`Invalid Indian PIN codes provided for Authority jurisdiction: ${invalidPins.join(', ')}`);
    }

    return new Authority(id, name, type, jurisdictionPinCodes);
  }
}
