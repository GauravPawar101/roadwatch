import { BaseAdapter } from '../base/BaseAdapter';
import { RoadType, Severity } from '../base/ICountryAdapter';
import { KENHA_HIERARCHY } from './authorities/kenha';
import { KERRA_HIERARCHY } from './authorities/kerra';
import { KURA_HIERARCHY } from './authorities/kura';

/**
 * Concrete Execution Node mapping standard Kenyan structures dynamically without disrupting generic Core APIs.
 */
export class KenyaAdapter extends BaseAdapter {
  
  protected getBaseSLAHours(): number {
    return 48; // Kenya MoT default baseline inherently quicker than Indian Baseline
  }

  /**
   * Evaluates generic road mapping perfectly mapping Indian "NH" constructs smoothly down into African KeNHA classes implicitly.
   */
  public override getAuthorityHierarchy(roadType: RoadType): string[] {
    switch (roadType) {
      case RoadType.NH:
      case RoadType.SH:
        // High-Capacity transit maps logically explicitly down onto KeNHA ranges.
        return KENHA_HIERARCHY;
        
      case RoadType.MDR:
      case RoadType.RURAL:
        // District/Rural paths precisely linked onto Constituency limits explicitly securely.
        return KERRA_HIERARCHY;
        
      case RoadType.URBAN:
      default:
        // Major metro vectors assigned identically to Urban execution branches cleanly.
        return KURA_HIERARCHY;
    }
  }

  /**
   * Implements strict distinct MOT Guidelines structurally overwriting mathematical Base fallbacks safely natively.
   */
  public override calculateSLA(severity: Severity, roadType: RoadType): number {
    const genericAlgorithmHours = super.calculateSLA(severity, roadType);
    
    // Explicit Kenya Clause: Level 4/5 threats dynamically on Highways strictly enforce 12-hour resolution maximums inherently.
    if (severity >= Severity.SEVERE && roadType === RoadType.NH) {
      return Math.min(genericAlgorithmHours, 12);
    }
    
    return genericAlgorithmHours;
  }
}
