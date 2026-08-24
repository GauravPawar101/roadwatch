import { describe, expect, it } from 'vitest';
import {
  scaleOrgKarmaDelta,
  getWorkBandFromScore,
  applySlaBreachContractorPenalty,
  applyRecurrencePenalty,
} from './karma-service.js';

describe('org karma size scaling', () => {
  it('penalizes small orgs more than large ones for the same base', () => {
    const base = -10;
    const small = scaleOrgKarmaDelta({ basePenalty: base, orgRoadKm: 5 });
    const large = scaleOrgKarmaDelta({ basePenalty: base, orgRoadKm: 10000 });
    expect(Math.abs(small)).toBeGreaterThan(Math.abs(large));
    expect(small).toBeLessThan(0);
    expect(large).toBeLessThan(0);
  });
});

describe('work bands and SLA penalties', () => {
  it('maps scores to work bands', () => {
    expect(getWorkBandFromScore(600)).toBe('Trusted');
    expect(getWorkBandFromScore(150)).toBe('Standard');
    expect(getWorkBandFromScore(40)).toBe('AtRisk');
  });

  it('builds contractor / recurrence transactions', () => {
    expect(applySlaBreachContractorPenalty('c1', -20)).toMatchObject({
      user_id: 'c1',
      delta: -20,
      reason: 'sla_breach_contractor',
    });
    expect(applyRecurrencePenalty('e1', -25).reason).toBe('recurrence_after_complete');
  });
});
