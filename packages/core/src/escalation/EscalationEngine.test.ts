import { describe, expect, it } from 'vitest';
import { EscalationEngine } from '../escalation/EscalationEngine.js';
import { isRegionalHoliday, getDatePartsInTimeZone } from '../utils/holidays.js';

const HIERARCHY = ['A', 'B', 'C'];

describe('EscalationEngine.nextInLinearHierarchy', () => {
  it('moves unknown authority to first tier', () => {
    expect(EscalationEngine.nextInLinearHierarchy('', HIERARCHY)).toEqual({
      fromAuthorityId: '',
      toAuthorityId: 'A',
      tier: 1,
    });
  });

  it('advances mid-tier', () => {
    expect(EscalationEngine.nextInLinearHierarchy('A', HIERARCHY)).toEqual({
      fromAuthorityId: 'A',
      toAuthorityId: 'B',
      tier: 2,
    });
  });

  it('stops at top', () => {
    expect(EscalationEngine.nextInLinearHierarchy('C', HIERARCHY)).toBeNull();
  });

  it('returns null for empty hierarchy', () => {
    expect(EscalationEngine.nextInLinearHierarchy('A', [])).toBeNull();
  });
});

describe('isRegionalHoliday', () => {
  it('flags Republic Day in Asia/Kolkata', () => {
    expect(isRegionalHoliday(new Date('2026-01-26T10:00:00+05:30'), 'Asia/Kolkata')).toBe(true);
  });

  it('does not flag ordinary days', () => {
    expect(isRegionalHoliday(new Date('2026-03-10T10:00:00+05:30'), 'Asia/Kolkata')).toBe(false);
  });

  it('getDatePartsInTimeZone is stable', () => {
    const p = getDatePartsInTimeZone(new Date('2026-08-15T23:00:00+05:30'), 'Asia/Kolkata');
    expect(p.md).toBe('08-15');
  });
});
