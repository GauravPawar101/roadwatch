import type { GeoLocation } from '../domain/Entities';
import { Complaint } from '../domain/Entities';
import { ComplaintStatus, DamageType, Severity } from '../domain/Enums';
import { calculateSLABreachDate } from '../utils/datetime';
import { calculateHaversineDistance } from '../utils/geo';

export class ComplaintEngine {
  
  /**
   * Constructs a new Complaint structure securely as a pure entity mapping function.
   */
  public file(
    authorId: string, 
    roadId: string, 
    location: GeoLocation, 
    damageType: DamageType, 
    severity: Severity,
    mediaIds: string[],
    timestamp: number = Date.now()
  ): Complaint {
    return new Complaint(
      `COMP-${timestamp}`,
      authorId,
      roadId,
      location,
      damageType,
      severity,
      timestamp,
      mediaIds,
      ComplaintStatus.Reported
    );
  }

  /**
   * Validates internal physical constraints of a Complaint object.
   */
  public validate(complaint: Complaint): boolean {
    if (!complaint.authorId || !complaint.roadId) return false;
    if (!complaint.location || typeof complaint.location.latitude !== 'number') return false;
    
    // Bounds check on explicitly declared 1-5 severity scale
    if (complaint.severity < 1 || complaint.severity > 5) return false;
    
    // Physical limitation: Do not allow Critical assignments without hard media evidence.
    if (complaint.severity >= 4 && complaint.mediaIds?.length === 0) return false;
    
    return true;
  }

  /**
   * Deduplicates entities purely evaluating GeoSpatial coordinates.
   * If an identical incident exists within a specific proximity threshold (e.g., 50 meters)
   * logged within the last 14 days, we consider the new entry a duplicate node flag.
   */
  public deduplicate(newComplaint: Complaint, existingComplaints: Complaint[]): Complaint | null {
    const PROXIMITY_THRESHOLD_KM = 0.05; // 50 meters distance logic
    const TIME_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000; // 14 days fallback logic

    for (const existing of existingComplaints) {
      if (existing.status === ComplaintStatus.Resolved || existing.status === ComplaintStatus.Rejected) {
        continue;
      }
      
      const timeDiff = newComplaint.timestamp - existing.timestamp;
      if (Math.abs(timeDiff) > TIME_THRESHOLD_MS) {
        continue;
      }

      const distance = calculateHaversineDistance(newComplaint.location, existing.location);
      if (distance <= PROXIMITY_THRESHOLD_KM && newComplaint.damageType === existing.damageType) {
        return existing; // Returns the existing active complaint instead of registering a duplicate
      }
    }
    
    return null; // Return cleanly if unique
  }

  /**
   * Escalates the severity of a complaint safely via pure immutable state transitions.
   */
  public escalate(complaint: Complaint, escalationNotes: string): Complaint {
    const newSeverity = Math.min(complaint.severity + 1, 5) as Severity;
    
    return new Complaint(
      complaint.id,
      complaint.authorId,
      complaint.roadId,
      complaint.location,
      complaint.damageType,
      newSeverity,
      complaint.timestamp,
      complaint.mediaIds,
      complaint.status,
      escalationNotes
    );
  }

  /**
   * Computes whether the complaint has breached pure Service Level Agreement structural deadlines.
   * Critical failures assume a strict 2-Day fix. Standard issues assume 7 elapsed working days.
   */
  public calculateSLAStatus(complaint: Complaint, currentTimeMS: number): { breached: boolean; dueDate: number } {
    const allowedDays = complaint.severity >= 4 ? 2 : 7;
    const projectedBreachDate = calculateSLABreachDate(complaint.timestamp, allowedDays);
    
    return {
      breached: currentTimeMS > projectedBreachDate && complaint.status !== ComplaintStatus.Resolved,
      dueDate: projectedBreachDate
    };
  }
}
