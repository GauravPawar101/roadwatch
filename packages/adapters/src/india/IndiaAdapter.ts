import { BaseAdapter } from '../base/BaseAdapter.js';
import { RoadType, Severity, ComplaintStatus } from '../base/ICountryAdapter.js';
import { INDIA_ROAD_REGEX } from './road-types/india-road-types.js';

import { NHAI_HIERARCHY } from './authorities/nhai.js';
import { PWD_HIERARCHY } from './authorities/pwd.js';
import { MUNICIPAL_HIERARCHY } from './authorities/municipal.js';
import { RTI_MAX_LEGAL_DAYS } from './legal/rti-framework.js';

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
   * Road-type primary grace with severity adjustment:
   * - NH / SH / MDR (highways): base 7 days (168h)
   * - URBAN / RURAL (local): base 2 days (48h)
   * Severity modifier: CRITICAL=0.5x, HIGH=0.75x, MODERATE=1x, LOW=1.5x
   * Env overrides: SLA_GRACE_HIGHWAY_HOURS / SLA_GRACE_LOCAL_HOURS
   */
  public override calculateSLA(severity: Severity, roadType: RoadType): number {
    const highwayHours = Number(process.env.SLA_GRACE_HIGHWAY_HOURS ?? 168);
    const localHours = Number(process.env.SLA_GRACE_LOCAL_HOURS ?? 48);
    const supremeLegalHardStop = RTI_MAX_LEGAL_DAYS * 24;

    const baseHours =
      roadType === RoadType.NH || roadType === RoadType.SH || roadType === RoadType.MDR
        ? highwayHours
        : localHours;

    // Severity modifier: higher severity = shorter SLA
    const severityMultiplier =
      severity === Severity.CRITICAL ? 0.5 :
      severity === Severity.HIGH ? 0.75 :
      severity === Severity.MODERATE ? 1.0 :
      1.5; // LOW

    const adjustedHours = Math.max(1, Math.floor(baseHours * severityMultiplier));

    return Math.min(adjustedHours, supremeLegalHardStop);
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
