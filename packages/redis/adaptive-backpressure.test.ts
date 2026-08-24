import { describe, expect, it } from 'vitest';

// Pure pressure math mirrored from adaptive resolver expectations.
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeLimits(bounds: {
  minRequestsPerWindow: number;
  maxRequestsPerWindow: number;
  minInflight: number;
  maxInflight: number;
}, pressure: number) {
  const requestSpan = bounds.maxRequestsPerWindow - bounds.minRequestsPerWindow;
  const inflightSpan = bounds.maxInflight - bounds.minInflight;
  const shrink = Math.min(1, pressure / 4);
  return {
    maxRequestsPerWindow: Math.round(
      clamp(bounds.maxRequestsPerWindow - requestSpan * shrink, bounds.minRequestsPerWindow, bounds.maxRequestsPerWindow)
    ),
    maxInflight: Math.round(
      clamp(bounds.maxInflight - inflightSpan * shrink, bounds.minInflight, bounds.maxInflight)
    )
  };
}

describe('adaptive admission envelope', () => {
  const bounds = {
    minRequestsPerWindow: 30,
    maxRequestsPerWindow: 120,
    minInflight: 6,
    maxInflight: 24
  };

  it('uses max capacity when healthy', () => {
    expect(computeLimits(bounds, 0)).toEqual({
      maxRequestsPerWindow: 120,
      maxInflight: 24
    });
  });

  it('shrinks toward min under high pressure', () => {
    expect(computeLimits(bounds, 4)).toEqual({
      maxRequestsPerWindow: 30,
      maxInflight: 6
    });
  });

  it('partially shrinks under moderate pressure', () => {
    const mid = computeLimits(bounds, 2);
    expect(mid.maxRequestsPerWindow).toBe(75);
    expect(mid.maxInflight).toBe(15);
  });
});
