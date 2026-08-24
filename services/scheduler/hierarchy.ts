/** India linear hierarchies (mirrors @roadwatch/adapters authority arrays). */
export const NHAI_HIERARCHY = ['PROJECT_DIRECTOR_PIU', 'REGIONAL_OFFICER_RO', 'CHAIRMAN_NHAI'];
export const PWD_HIERARCHY = ['ASSISTANT_ENGINEER', 'EXECUTIVE_ENGINEER', 'SUPERINTENDING_ENGINEER'];
export const MUNICIPAL_HIERARCHY = ['WARD_ASSISTANT_ENGINEER', 'ZONAL_COMMISSIONER', 'MUNICIPAL_COMMISSIONER'];

export function hierarchyForRoadType(roadType: string | null | undefined): string[] {
  const raw = String(roadType ?? '').trim().toUpperCase();
  if (raw === 'NH' || raw.startsWith('NH')) return NHAI_HIERARCHY;
  if (raw === 'SH' || raw.startsWith('SH') || raw === 'MDR' || raw.startsWith('MDR')) return PWD_HIERARCHY;
  return MUNICIPAL_HIERARCHY;
}
