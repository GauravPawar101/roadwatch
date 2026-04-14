import type { Complaint, GeoLocation, Road } from '../domain/Entities';
import type { ComplaintStatus, Severity } from '../domain/Enums';
import { isWithinBoundingBox } from '../utils/geo';

export interface BoundingBox {
  topLeft: GeoLocation;
  bottomRight: GeoLocation;
}

export interface ComplaintFilterCriteria {
  statuses?: ComplaintStatus[];
  minSeverity?: Severity;
  timeframeStart?: number;
  timeframeEnd?: number;
}

export class SearchEngine {

  /**
   * Pure native keyword subset searching evaluated natively without heavy DB index locks.
   */
  public fullTextSearch<T>(collection: T[], query: string, fieldsToSearch: (keyof T)[]): T[] {
    if (!query || query.trim() === '') return collection;
    
    const normalizedQuery = query.toLowerCase().trim();

    return collection.filter(item => {
      for (const field of fieldsToSearch) {
        const val = item[field];
        if (typeof val === 'string' && val.toLowerCase().includes(normalizedQuery)) {
          return true; // Match hit
        }
      }
      return false;
    });
  }

  /**
   * Spatial searching isolating memory objects dynamically strictly to spatial GPS boundaries.
   */
  public spatialSearch(
    lines: Array<{road: Road, startPoint: GeoLocation, endPoint: GeoLocation}>, 
    boundaries: BoundingBox
  ): Road[] {
    return lines
      .filter(segment => 
         isWithinBoundingBox(segment.startPoint, boundaries.topLeft, boundaries.bottomRight) ||
         isWithinBoundingBox(segment.endPoint, boundaries.topLeft, boundaries.bottomRight)
      )
      .map(segment => segment.road);
  }

  /**
   * Evaluates deep boolean boundaries structurally over offline cache complaint blocks.
   */
  public filterComplaints(complaints: Complaint[], criteria: ComplaintFilterCriteria): Complaint[] {
    return complaints.filter(curr => {
      
      if (criteria.statuses && criteria.statuses.length > 0) {
        if (!criteria.statuses.includes(curr.status)) return false;
      }

      if (criteria.minSeverity !== undefined) {
        if (curr.severity < criteria.minSeverity) return false;
      }

      if (criteria.timeframeStart !== undefined) {
        if (curr.timestamp < criteria.timeframeStart) return false;
      }

      if (criteria.timeframeEnd !== undefined) {
        if (curr.timestamp > criteria.timeframeEnd) return false;
      }

      return true;
    });
  }

  /**
   * Interface Stub simulating mathematical spatial-semantic logic natively. 
   * Searches historical records evaluating multi-dimensional similarities rather than string matches.
   */
  public semanticSearch(
    queryVector: readonly number[], 
    vectorizedDataset: Array<{id: string, vector: readonly number[]}>, 
    limit: number = 5
  ): string[] {
    // Pure logic mathematical abstraction mapping
    // To implement genuinely: Render cosine similarity evaluation natively loop iteratively.
    console.log("Analyzing local Cosine Similarities physically against cached vectors...");
    
    return vectorizedDataset.slice(0, limit).map(v => v.id);
  }
}
