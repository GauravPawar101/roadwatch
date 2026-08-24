import { describe, expect, it } from 'vitest';
import { EscalationEngine, isRegionalHoliday, getDatePartsInTimeZone } from '@roadwatch/core';
import { hierarchyForRoadType, NHAI_HIERARCHY, MUNICIPAL_HIERARCHY, PWD_HIERARCHY } from './hierarchy.js';

describe('hierarchyForRoadType', () => {
  it('maps NH to NHAI hierarchy', () => {
    expect(hierarchyForRoadType('NH')).toEqual(NHAI_HIERARCHY);
    expect(hierarchyForRoadType('NH-48')).toEqual(NHAI_HIERARCHY);
  });

  it('maps SH/MDR to PWD hierarchy', () => {
    expect(hierarchyForRoadType('SH')).toEqual(PWD_HIERARCHY);
    expect(hierarchyForRoadType('MDR-4')).toEqual(PWD_HIERARCHY);
  });

  it('defaults urban/rural to municipal hierarchy', () => {
    expect(hierarchyForRoadType('URBAN')).toEqual(MUNICIPAL_HIERARCHY);
    expect(hierarchyForRoadType(null)).toEqual(MUNICIPAL_HIERARCHY);
  });
});

describe('EscalationEngine.nextInLinearHierarchy', () => {
  it('assigns first tier when current is unknown', () => {
    expect(EscalationEngine.nextInLinearHierarchy('UNKNOWN', NHAI_HIERARCHY)).toEqual({
      fromAuthorityId: 'UNKNOWN',
      toAuthorityId: 'PROJECT_DIRECTOR_PIU',
      tier: 1,
    });
  });

  it('advances one step in the hierarchy', () => {
    expect(EscalationEngine.nextInLinearHierarchy('PROJECT_DIRECTOR_PIU', NHAI_HIERARCHY)).toEqual({
      fromAuthorityId: 'PROJECT_DIRECTOR_PIU',
      toAuthorityId: 'REGIONAL_OFFICER_RO',
      tier: 2,
    });
  });

  it('returns null at the top of the hierarchy', () => {
    expect(EscalationEngine.nextInLinearHierarchy('CHAIRMAN_NHAI', NHAI_HIERARCHY)).toBeNull();
  });
});

describe('isRegionalHoliday', () => {
  it('detects fixed India national holidays in Asia/Kolkata', () => {
    // 2026-01-26 is Republic Day (Monday)
    const republicDay = new Date('2026-01-26T08:00:00+05:30');
    expect(isRegionalHoliday(republicDay, 'Asia/Kolkata')).toBe(true);

    const independenceDay = new Date('2026-08-15T08:00:00+05:30');
    expect(isRegionalHoliday(independenceDay, 'Asia/Kolkata')).toBe(true);
  });

  it('returns false on ordinary weekdays', () => {
    const ordinary = new Date('2026-08-12T08:00:00+05:30');
    expect(isRegionalHoliday(ordinary, 'Asia/Kolkata')).toBe(false);
  });

  it('honors extra YYYY-MM-DD holidays', () => {
    const diwali = new Date('2026-11-08T12:00:00+05:30');
    expect(isRegionalHoliday(diwali, 'Asia/Kolkata')).toBe(false);
    expect(isRegionalHoliday(diwali, 'Asia/Kolkata', ['2026-11-08'])).toBe(true);
  });

  it('getDatePartsInTimeZone returns Kolkata calendar date', () => {
    const parts = getDatePartsInTimeZone(new Date('2026-01-26T00:30:00+05:30'), 'Asia/Kolkata');
    expect(parts.md).toBe('01-26');
    expect(parts.ymd).toBe('2026-01-26');
  });
});
