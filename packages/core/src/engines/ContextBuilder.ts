import type { Complaint } from '../domain/Complaint';
import type { GeoCoordinate } from '../domain/GeoCoordinate';
import type { IStorageProvider } from '../interfaces/IStorageProvider';
import type { RecognizedIntent } from './IntentClassifier';

// Explicit bounding box defining the spatial context for queries.
export interface BoundingBox {
  topLeft: GeoCoordinate;
  bottomRight: GeoCoordinate;
}

export interface UserRolePrivileges {
  canFileComplaints: boolean;
  canVerifyComplaints: boolean;
  isGovernmentOfficial: boolean;
  maxUploadBoundaryMB: number;
}

export interface SessionState {
  userId: string;
  timestamp: number;
  activeIntent: RecognizedIntent;
}

export interface RoadProfile {
  roadId: string | null;
  approximateCondition: string;
}

export interface ContextPayload {
  sessionState: SessionState;
  roadProfile: RoadProfile | null;
  recentHistory: Complaint[];
  userPrivileges: UserRolePrivileges;
}

export class ContextBuilder {
  constructor(private readonly storageProvider: IStorageProvider) {}

  /**
   * Orchestrates the gathering of ambient data strictly via Dependency Injection.
   * Pulls physical records from SQLite, identifies the session layer and spatial bounds.
   */
  public async buildContext(
    intentResult: RecognizedIntent,
    userId: string,
    boundingBox?: BoundingBox
  ): Promise<ContextPayload> {
    
    // 1. Establish the exact timeline and state of the user's session
    const sessionState: SessionState = {
      userId,
      timestamp: Date.now(),
      activeIntent: intentResult
    };

    // 2. Fetch internal logical privileges based on ID prefix or mocked DB read
    const privileges = this.getUserPrivileges(userId);

    // 3. Query the Offline Store for relevant histories
    // Simulating SELECT * FROM complaints WHERE ...
    const allComplaints = await this.storageProvider.getAllComplaints();
    
    let relevantHistory = allComplaints.filter(c => c.authorId === userId);
    
    // Inject spatial constraints if a geo-boundary was provided
    if (boundingBox) {
      relevantHistory = relevantHistory.filter(c => 
        // Note: Latitude goes completely South as it drops from North. 
        // Assuming TopLeft is Northwest and BottomRight is Southeast.
        c.location.latitude <= boundingBox.topLeft.latitude &&
        c.location.latitude >= boundingBox.bottomRight.latitude &&
        c.location.longitude >= boundingBox.topLeft.longitude &&
        c.location.longitude <= boundingBox.bottomRight.longitude
      );
    }

    // Constrain to the 5 most recent records purely for LLM/prompt size efficiency
    relevantHistory = relevantHistory
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5);

    // 4. Construct the surrounding Road Asset Profile
    let roadProfile: RoadProfile | null = null;
    if (boundingBox) {
       // Mock: We'd ordinarily intersect the geo-box against offline GeoJSON tables
       // directly in SQLite or MapLibre.
      roadProfile = {
        roadId: "MAP_ASSET_NH_48",
        approximateCondition: "Requires priority maintenance"
      };
    }

    // 5. Assemble and Return the completely sanitized pipeline payload
    return {
      sessionState,
      roadProfile,
      recentHistory: relevantHistory,
      userPrivileges: privileges
    };
  }

  /**
   * Extrapolates User Constraints.
   */
  private getUserPrivileges(userId: string): UserRolePrivileges {
    if (userId.startsWith('NHAI_') || userId.startsWith('PWD_')) {
      return {
        canFileComplaints: true,
        canVerifyComplaints: true,
        isGovernmentOfficial: true,
        maxUploadBoundaryMB: 250 // Extended allocations for official engineers
      };
    }
    
    return {
      canFileComplaints: true,
      canVerifyComplaints: false,
      isGovernmentOfficial: false,
      maxUploadBoundaryMB: 20 // Fair-usage data constraints for citizens
    };
  }
}
