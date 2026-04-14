import { Road, Authority } from '../domain/Entities';
import { RoadType, UserRole } from '../domain/Enums';

export class RoutingEngine {
  /**
   * Maps physical road categories cleanly to overarching Indian governing agencies.
   * Ensures UI workflows know identically which hierarchical tree to ping.
   */
  public getAuthorityLevels(roadType: RoadType): string[] {
    switch (roadType) {
      case RoadType.NH:
        return ['NHAI', 'MoRTH'];
      case RoadType.SH:
      case RoadType.MDR:
        return ['State PWD'];
      case RoadType.Urban:
        return ['Municipal Corporation', 'Urban Development Authority'];
      case RoadType.Rural:
        return ['Gram Panchayat', 'Zila Parishad', 'Rural Engineering Services'];
      default:
        return ['Unknown Authority'];
    }
  }

  /**
   * Extrapolates standard Indian public works administrative escalation cascades logically.
   */
  public getEscalationPath(roadType: RoadType): UserRole[] {
    // National and State level highway structures generally flow linearly upward.
    if (roadType === RoadType.NH || roadType === RoadType.SH) {
      return [
        UserRole.FIELD_INSPECTOR,
        UserRole.EXECUTIVE_ENGINEER,
        UserRole.SUPERINTENDENT_ENG,
        UserRole.CHIEF_ENGINEER
      ];
    }
    
    // Rural/Urban municipal blocks might skip SE tier loops.
    return [
      UserRole.FIELD_INSPECTOR,
      UserRole.EXECUTIVE_ENGINEER,
      UserRole.CHIEF_ENGINEER,
      UserRole.ADMIN
    ];
  }

  /**
   * Pure constraint evaluation ensuring an official logically holds domain overlapping the specific road segment's ownership node.
   */
  public validateJurisdiction(authorityRecord: Authority, road: Road): boolean {
    if (authorityRecord.level === 'National' && road.type === RoadType.NH) {
      return true; // NHAI official accounts natively map permissions over NH categories fully.
    }

    if (road.authorityId === authorityRecord.id) {
      return true; // Direct foreign key match verification
    }
    
    return false;
  }
}
