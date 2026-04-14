import type { ICountryAdapter } from './ICountryAdapter';
import { ComplaintStatus, RoadType, Severity } from './ICountryAdapter';

/**
 * Abstract Generic Base.
 * Offloads 80% of repetitive generic math logically, forcing inherited specific Country extensions
 * directly to explicitly override only strict legal deviations locally safely.
 */
export abstract class BaseAdapter implements ICountryAdapter {
  
  /**
   * Inheriting subclasses rigidly specify universal baseline constants dynamically.
   */
  protected abstract getBaseSLAHours(): number;

  public getAuthorityHierarchy(roadType: RoadType): string[] {
    // Universal arbitrary fallback mapping sequentially
    return ['DEFAULT_LOCAL_ENGINEER', 'DEFAULT_DISTRICT_SUPERINTENDENT'];
  }

  public calculateSLA(severity: Severity, roadType: RoadType): number {
    const baseline = this.getBaseSLAHours();
    
    // Universal inverse heuristic: Higher severity physically constrains duration matrices fractionally
    // A Severity 5 (Critical) naturally forces arrays to return 20% of the baseline time locally.
    const computedHours = Math.max(24, Math.floor(baseline / severity));
    
    return computedHours;
  }

  public getEscalationPath(currentStatus: ComplaintStatus): ComplaintStatus[] {
    // Pure mathematically constrained chronological resolution flow boundaries.
    switch (currentStatus) {
      case ComplaintStatus.FILED: 
         return [ComplaintStatus.ASSIGNED, ComplaintStatus.ESCALATED];
      case ComplaintStatus.ASSIGNED: 
         return [ComplaintStatus.IN_PROGRESS, ComplaintStatus.ESCALATED];
      case ComplaintStatus.IN_PROGRESS: 
         return [ComplaintStatus.RESOLVED, ComplaintStatus.ESCALATED];
      default: 
         return [ComplaintStatus.ESCALATED];
    }
  }

  public formatRoadId(rawInput: string): string {
    // Enforces strict alpha-number extraction natively stripping blank allocations fundamentally.
    return rawInput.trim().toUpperCase().replace(/\\s+/g, '-');
  }
}
