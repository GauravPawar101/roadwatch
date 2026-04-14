import { RoadType } from '../../base/ICountryAdapter';

/**
 * Standard explicitly mapped RegEx boundaries extracting bureaucratic validation patterns naturally.
 * Physically anchors chaotic user keyboard inputs structurally onto Indian administrative standards.
 */
export const INDIA_ROAD_REGEX = {
  NH: /^NH-\d+[A-Z]?$/,          // e.g., NH-44, NH-48A
  SH: /^SH-\d+[A-Z]?$/,          // e.g., SH-10
  MDR: /^MDR-\d+$/,              // e.g., MDR-4
  ODR: /^ODR-\d+$/,              // Other District Roads (e.g., ODR-1)
  VR: /^VR-\d+$/                 // Village Roads (e.g., VR-101)
};

/**
 * Funnels physical Indian string parameters linearly down compressing into mathematical Core Domain Enums.
 */
export function mapIndianRoadToDomainType(rawId: string): RoadType {
  const normalized = rawId.trim().toUpperCase().replace(/\\s+/g, '-');
  
  if (INDIA_ROAD_REGEX.NH.test(normalized)) return RoadType.NH;
  if (INDIA_ROAD_REGEX.SH.test(normalized)) return RoadType.SH;
  if (INDIA_ROAD_REGEX.MDR.test(normalized)) return RoadType.MDR;
  
  // Both ODR and VR systematically map down towards generic structural RURAL arrays internally 
  // explicitly preventing massive permutations traversing up into the core domain logical boundaries.
  if (INDIA_ROAD_REGEX.ODR.test(normalized)) return RoadType.RURAL; 
  if (INDIA_ROAD_REGEX.VR.test(normalized)) return RoadType.RURAL; 
  
  // Implicitly falls logically down assuming it traces to an urban metro municipality segment realistically
  return RoadType.URBAN; 
}
