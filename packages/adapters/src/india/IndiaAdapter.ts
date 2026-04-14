import { BaseAdapter } from '../base/BaseAdapter';
import { RoadType, Severity, ComplaintStatus } from '../base/ICountryAdapter';
import { INDIA_ROAD_REGEX } from './road-types/india-road-types';

import { NHAI_HIERARCHY } from './authorities/nhai';
import { PWD_HIERARCHY } from './authorities/pwd';
import { MUNICIPAL_HIERARCHY } from './authorities/municipal';
import { RTI_MAX_LEGAL_DAYS } from './legal/rti-framework';

/**
 * Explicit Structural Strategy implementing precisely isolated Indian Laws securely physically.
 */
export class IndiaAdapter extends BaseAdapter {
  
  protected getBaseSLAHours(): number {
    return 72; // India National Baseline Standard Dynamically
  }

  /**
   * Translates wildly complex administrative tiers functionally into physical code assignments globally.
   */
  public override getAuthorityHierarchy(roadType: RoadType): string[] {
    switch (roadType) {
      case RoadType.NH:
        return NHAI_HIERARCHY;
      case RoadType.SH:
      case RoadType.MDR:
        return PWD_HIERARCHY;
      case RoadType.RURAL:
      case RoadType.URBAN:
      default:
        return MUNICIPAL_HIERARCHY;
    }
  }

  /**
   * Merges pure mathematical resolution abstractions with hard Indian Constitutional matrices inherently.
   */
  public override calculateSLA(severity: Severity, roadType: RoadType): number {
    // Fetches pure algorithmic fractionally scaled timeline natively inherited from BaseAdapter
    const algorithmicHours = super.calculateSLA(severity, roadType);
    
    // Enforces the supreme legal 30-Day limit ceiling structurally across all algorithmic derivations.
    const supremeLegalHardStop = RTI_MAX_LEGAL_DAYS * 24; 
    
    return Math.min(algorithmicHours, supremeLegalHardStop);
  }

  /**
   * Cleans structural invariants logically enforcing strict NHAI patterns natively.
   */
  public override formatRoadId(rawInput: string): string {
    const baselineFormatted = rawInput.trim().toUpperCase().replace(/\\s+/g, '-');
    
    if (INDIA_ROAD_REGEX.NH.test(baselineFormatted) || 
        INDIA_ROAD_REGEX.SH.test(baselineFormatted) || 
        INDIA_ROAD_REGEX.MDR.test(baselineFormatted)) {
       return baselineFormatted;
    }

    // Resolves broken inputs natively "nh 44" -> "NH-44" gracefully
    return baselineFormatted.replace(/^([A-Z]{2,3})[\\s-]*(\\d+[A-Z]?)$/, '$1-$2');
  }
}
