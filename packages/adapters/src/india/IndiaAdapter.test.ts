import { describe, expect, it } from 'vitest';
import { IndiaAdapter } from '../india/IndiaAdapter.js';
import { RoadType, Severity } from '../base/ICountryAdapter.js';

describe('IndiaAdapter graded SLA', () => {
  const adapter = new IndiaAdapter();

  it('gives 7 days (168h) for NH/SH/MDR', () => {
    expect(adapter.calculateSLA(Severity.MODERATE, RoadType.NH)).toBe(168);
    expect(adapter.calculateSLA(Severity.LOW, RoadType.SH)).toBe(168);
    expect(adapter.calculateSLA(Severity.HIGH, RoadType.MDR)).toBe(168);
  });

  it('gives 2 days (48h) for URBAN/RURAL', () => {
    expect(adapter.calculateSLA(Severity.MODERATE, RoadType.URBAN)).toBe(48);
    expect(adapter.calculateSLA(Severity.CRITICAL, RoadType.RURAL)).toBe(48);
  });
});
