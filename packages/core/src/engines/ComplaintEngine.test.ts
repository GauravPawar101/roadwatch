import { describe, expect, it } from 'vitest';
import { DamageType, Severity } from '../domain/Enums';
import { ComplaintEngine } from './ComplaintEngine';

describe('ComplaintEngine', () => {
  it('files a complaint with deterministic id prefix', () => {
    const engine = new ComplaintEngine();
    const complaint = engine.file(
      'user-1',
      'road-1',
      { latitude: 18.5204, longitude: 73.8567 },
      DamageType.Pothole,
      3 as Severity,
      ['m1'],
      1710000000000
    );

    expect(complaint.id).toBe('COMP-1710000000000');
    expect(complaint.authorId).toBe('user-1');
    expect(complaint.roadId).toBe('road-1');
  });

  it('rejects critical complaints without media evidence', () => {
    const engine = new ComplaintEngine();
    const complaint = engine.file(
      'user-1',
      'road-1',
      { latitude: 18.5204, longitude: 73.8567 },
      DamageType.Pothole,
      4 as Severity,
      [],
      1710000000000
    );

    expect(engine.validate(complaint)).toBe(false);
  });

  it('deduplicates within 50m and 14 days for same damage type', () => {
    const engine = new ComplaintEngine();

    const existing = engine.file(
      'user-1',
      'road-1',
      { latitude: 18.5204, longitude: 73.8567 },
      DamageType.Pothole,
      3 as Severity,
      ['m1'],
      1710000000000
    );

    const near = engine.file(
      'user-2',
      'road-1',
      { latitude: 18.52041, longitude: 73.8567 },
      DamageType.Pothole,
      3 as Severity,
      ['m2'],
      1710001000000
    );

    const dup = engine.deduplicate(near, [existing]);
    expect(dup?.id).toBe(existing.id);
  });
});
