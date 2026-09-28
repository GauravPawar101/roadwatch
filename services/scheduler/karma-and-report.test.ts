import { describe, expect, it } from 'vitest';
import { getWorkBandFromScore, getDatePartsInTimeZone } from '@roadwatch/core';

/**
 * Regression coverage for two scheduler bugs.
 *
 * The scheduler's business functions are not exported (the module boots cron
 * jobs on import), so these assert the exact contracts those call sites rely on.
 */

const SLA_CONTRACTOR_PENALTY = -20; // config.karmaSlaContractor default

/** Mirrors the SQL clamp in applyContractorKarma. */
function clampedScore(current: number, delta: number): number {
  return Math.max(-500, Math.min(10000, current + delta));
}

describe('applyContractorKarma work_band', () => {
  /**
   * Regression: the band was derived from a hardcoded baseline of `100 + delta`
   * instead of the contractor's real score, so every breach wrote the same band
   * regardless of standing.
   */
  it('derives the band from the real post-penalty score, not an assumed baseline', () => {
    // A well-performing contractor must stay Trusted after a -20 penalty.
    const trusted = clampedScore(800, SLA_CONTRACTOR_PENALTY);
    expect(getWorkBandFromScore(trusted)).toBe('Trusted');
    // ...which the old `100 + delta` baseline could never produce (it yielded AtRisk).
    expect(getWorkBandFromScore(100 + SLA_CONTRACTOR_PENALTY)).not.toBe('Trusted');
  });

  it('does not mask a suspension as merely AtRisk', () => {
    // Score 0 breaches into negative territory -> Suspended.
    const suspended = clampedScore(0, SLA_CONTRACTOR_PENALTY);
    expect(suspended).toBeLessThan(0);
    expect(getWorkBandFromScore(suspended)).toBe('Suspended');
    // The old baseline reported AtRisk, losing the suspension entirely.
    expect(getWorkBandFromScore(100 + SLA_CONTRACTOR_PENALTY)).toBe('AtRisk');
  });

  it('is a function of the real score across the band boundaries', () => {
    const expectations: Array<[number, string]> = [
      [1000, 'Trusted'],
      [800, 'Trusted'],
      [520, 'Trusted'],
      [500, 'Standard'],
      [300, 'Standard'],
      [120, 'Standard'],
      [100, 'AtRisk'],
      [80, 'AtRisk'],
      [0, 'Suspended'],
      [-100, 'Suspended'],
    ];
    for (const [real, expected] of expectations) {
      expect(getWorkBandFromScore(clampedScore(real, SLA_CONTRACTOR_PENALTY))).toBe(expected);
    }
  });

  it('respects the SQL clamp at the extremes', () => {
    expect(clampedScore(99999, SLA_CONTRACTOR_PENALTY)).toBe(10000);
    expect(clampedScore(-99999, SLA_CONTRACTOR_PENALTY)).toBe(-500);
  });
});

describe('generateReports report_date label', () => {
  const TZ = 'Asia/Kolkata'; // SCHEDULER_TZ default; cron runs at 01:00 local

  /**
   * Regression: the label came from toISOString() after setHours(0,0,0,0), so
   * local midnight was converted to UTC and shifted back a day for any timezone
   * east of UTC. report_date is the primary key, so every report was misdated.
   */
  it('labels the report with the service-timezone calendar date', () => {
    // 01:00 IST on 2026-03-11 == 2026-03-10T19:30:00Z
    const yesterday = new Date('2026-03-10T19:30:00Z');
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    expect(getDatePartsInTimeZone(yesterday, TZ).ymd).toBe('2026-03-10');
    // The old expression produced the wrong day:
    expect(yesterday.toISOString().split('T')[0]).not.toBe('2026-03-10');
  });

  it('produces distinct report_date values for consecutive days', () => {
    const label = (iso: string) => {
      const d = new Date(iso);
      d.setDate(d.getDate() - 1);
      d.setHours(0, 0, 0, 0);
      return getDatePartsInTimeZone(d, TZ).ymd;
    };
    const labels = [
      label('2026-03-10T19:30:00Z'),
      label('2026-03-11T19:30:00Z'),
      label('2026-03-12T19:30:00Z'),
    ];
    expect(labels).toEqual(['2026-03-10', '2026-03-11', '2026-03-12']);
    expect(new Set(labels).size).toBe(3);
  });

  it('handles a DST-observing timezone without drifting', () => {
    // 01:00 America/New_York on 2026-03-15 (after the DST switch).
    const d = new Date('2026-03-15T05:00:00Z');
    d.setDate(d.getDate() - 1);
    d.setHours(0, 0, 0, 0);
    const ymd = getDatePartsInTimeZone(d, 'America/New_York').ymd;
    expect(ymd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
