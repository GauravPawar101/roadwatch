import { describe, expect, it } from 'vitest';
import { IndiaAdapter } from '../india/IndiaAdapter.js';
import { RoadType, Severity } from '../base/ICountryAdapter.js';

describe('IndiaAdapter graded SLA with severity', () => {
  const adapter = new IndiaAdapter();

  it('gives 7 days (168h) base for NH/SH/MDR, modified by severity', () => {
    expect(adapter.calculateSLA(Severity.CRITICAL, RoadType.NH)).toBe(84);   // 168 * 0.5
    expect(adapter.calculateSLA(Severity.HIGH, RoadType.NH)).toBe(126);      // 168 * 0.75
    expect(adapter.calculateSLA(Severity.MODERATE, RoadType.NH)).toBe(168);  // 168 * 1.0
    expect(adapter.calculateSLA(Severity.LOW, RoadType.NH)).toBe(252);       // 168 * 1.5
    expect(adapter.calculateSLA(Severity.MODERATE, RoadType.SH)).toBe(168);
    expect(adapter.calculateSLA(Severity.MODERATE, RoadType.MDR)).toBe(168);
  });

  it('gives 2 days (48h) base for URBAN/RURAL, modified by severity', () => {
    expect(adapter.calculateSLA(Severity.CRITICAL, RoadType.URBAN)).toBe(24);  // 48 * 0.5
    expect(adapter.calculateSLA(Severity.HIGH, RoadType.URBAN)).toBe(36);      // 48 * 0.75
    expect(adapter.calculateSLA(Severity.MODERATE, RoadType.URBAN)).toBe(48);  // 48 * 1.0
    expect(adapter.calculateSLA(Severity.LOW, RoadType.URBAN)).toBe(72);       // 48 * 1.5
    expect(adapter.calculateSLA(Severity.MODERATE, RoadType.RURAL)).toBe(48);
  });
});
