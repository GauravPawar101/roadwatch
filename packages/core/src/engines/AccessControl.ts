export enum UserRole {
  CITIZEN = 'CITIZEN',
  FIELD_INSPECTOR = 'FIELD_INSPECTOR',
  EXECUTIVE_ENGINEER = 'EXECUTIVE_ENGINEER', // EE
  SUPERINTENDENT_ENG = 'SUPERINTENDENT_ENG', // SE
  CHIEF_ENGINEER = 'CHIEF_ENGINEER', // CE
  CONTRACTOR_REP = 'CONTRACTOR_REP',
  ADMIN = 'ADMIN'
}

export interface UserContext {
  id: string;
  role: UserRole;
  zone_id?: string;
  state_id?: string;
}

export interface ComplaintFencingData {
  id: string;
  zone_id: string;
  state_id: string;
}

export class PermissionGatekeeper {

  /**
   * Determines if the user role allows them to view internal departmental notes.
   * Blocks Citizens and basic Contractor Representatives from internal chatter.
   */
  public canViewInternalNotes(role: UserRole): boolean {
    const authorizedRoles = new Set([
      UserRole.FIELD_INSPECTOR,
      UserRole.EXECUTIVE_ENGINEER,
      UserRole.SUPERINTENDENT_ENG,
      UserRole.CHIEF_ENGINEER,
      UserRole.ADMIN
    ]);
    return authorizedRoles.has(role);
  }

  /**
   * Determines if the user role can safely mutate official state/blockchain audits.
   * Only high-ranking officials and system admins can execute state alterations here.
   */
  public canModifyChain(role: UserRole): boolean {
    const authorizedRoles = new Set([
      UserRole.SUPERINTENDENT_ENG,
      UserRole.CHIEF_ENGINEER,
      UserRole.ADMIN
    ]);
    return authorizedRoles.has(role);
  }

  /**
   * Determines if the role possesses the authority to assign field testing teams.
   */
  public canAssignInspector(role: UserRole): boolean {
    const authorizedRoles = new Set([
      UserRole.EXECUTIVE_ENGINEER,
      UserRole.SUPERINTENDENT_ENG,
      UserRole.CHIEF_ENGINEER,
      UserRole.ADMIN
    ]);
    return authorizedRoles.has(role);
  }

  /**
   * Evaluates jurisdiction fencing logic. An Executive Engineer cannot fetch or mutate
   * complaints outside of their assigned municipality or zone_id.
   * Higher ranks (like Chief Engineers or Admins) evaluate under larger boundaries.
   */
  public canAccessComplaint(user: UserContext, complaint: ComplaintFencingData): boolean {
    // 1. Global Bypass
    if (user.role === UserRole.ADMIN) {
      return true;
    }
    
    // 2. State-Level Fencing (Chief Engineer oversees an entire state, not just a zone)
    if (user.role === UserRole.CHIEF_ENGINEER) {
      if (!user.state_id) return false;
      return user.state_id === complaint.state_id;
    }

    // 3. Zone-Level Fencing
    if (
      user.role === UserRole.EXECUTIVE_ENGINEER || 
      user.role === UserRole.SUPERINTENDENT_ENG || 
      user.role === UserRole.FIELD_INSPECTOR ||
      user.role === UserRole.CONTRACTOR_REP
    ) {
      if (!user.zone_id) return false;
      return user.zone_id === complaint.zone_id;
    }

    // 4. Default Fallback (Citizens have their own authorId checks applied elsewhere)
    return user.role === UserRole.CITIZEN;
  }
}
