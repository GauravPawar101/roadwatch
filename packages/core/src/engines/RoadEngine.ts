import type { BudgetRecord, Complaint, GeoLocation, Road } from '../domain/Entities';
import { ComplaintStatus } from '../domain/Enums';
import { calculateHaversineDistance } from '../utils/geo';

export class RoadEngine {
  
  /**
   * Matches raw physical coordinates to a recognized road asset.
   * Function operates purely using logical snapping algorithms.
   */
  public identifyFromGPS(location: GeoLocation, availableRoads: Array<{road: Road, centerPoint: GeoLocation}>): Road | null {
    const MAX_SNAP_DISTANCE_KM = 0.5; // Will only assume snapping to roads inside a 500m radius
    let closestRoad: Road | null = null;
    let minDistance = Number.MAX_VALUE;

    for (const segment of availableRoads) {
      const distance = calculateHaversineDistance(location, segment.centerPoint);
      if (distance < minDistance && distance <= MAX_SNAP_DISTANCE_KM) {
        minDistance = distance;
        closestRoad = segment.road;
      }
    }

    return closestRoad;
  }

  /**
   * Derives functionally a dynamic 1-100 road condition metric based on real-time factors
   * simulating decay mathematics without relying on network sync calculations. 
   * 100 = Optimal. 0 = Unsafe/Destroyed.
   */
  public calculateConditionScore(roadId: string, complaints: Complaint[], lastMaintenanceDateMS: number, currentTimeMS: number): number {
    let score = 100;

    // 1. Compile User-Identified Fault Deductions
    const activeComplaints = complaints.filter(
      c => c.roadId === roadId && c.status !== ComplaintStatus.Resolved && c.status !== ComplaintStatus.Rejected
    );
    
    for (const defect of activeComplaints) {
      // Deduct severity logarithmically or linearly. (Using linear 2.5 multiplier here)
      score -= (defect.severity * 2.5);
    }

    // 2. Physical Time-Decay Depreciation Penalty
    const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
    const yearsSinceMaintenance = (currentTimeMS - lastMaintenanceDateMS) / ONE_YEAR_MS;
    
    // Applying a flattened 5-point deduction for every year the surface is unmaintained
    if (yearsSinceMaintenance > 0) {
       score -= (yearsSinceMaintenance * 5.0);
    }

    // Pure constraint clamps the final value rigidly
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Condenses a temporal timeline strictly merging budgets and reports against a single road ID.
   * Useful for exporting logical audit timelines directly to the mobile UI graphs.
   */
  public buildHistory(roadId: string, complaints: Complaint[], budgets: BudgetRecord[]): Array<Record<string, unknown>> {
    const history: Array<Record<string, unknown>> = [];

    // Process all structural physical fault reports
    complaints.filter(c => c.roadId === roadId).forEach(c => {
      history.push({
        type: 'INCIDENT',
        timestamp: c.timestamp,
        meta: `Damage Extent: ${c.damageType} [Severity Level: ${c.severity}]`,
        status: c.status
      });
    });

    // Process all capital allocation injection variables
    budgets.filter(b => b.roadId === roadId).forEach(b => {
      history.push({
        type: 'MAINTENANCE_BUDGET',
        timestamp: b.allocationDate,
        meta: `Capital Allocation: ₹${b.allocatedAmount} (${b.contractorId})`
      });
    });

    // Execute pure functional reduction and mathematical sorting internally.
    return history.sort((a, b) => (b.timestamp as number) - (a.timestamp as number));
  }
}
