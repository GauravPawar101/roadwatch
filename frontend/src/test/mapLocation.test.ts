import { describe, expect, it, vi } from 'vitest';
import {
  DELHI_CENTER,
  invalidateMapSoon,
  isValidLatLng,
  resolveMapCenter,
  type MapCenter,
} from '../lib/mapLocation';

/** Replace navigator.geolocation for one assertion. */
function withGeolocation(
  impl: (success: PositionCallback, failure?: PositionErrorCallback | null) => void,
) {
  const original = Object.getOwnPropertyDescriptor(navigator, 'geolocation');
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    get: () => ({ getCurrentPosition: impl }),
  });
  return () => {
    if (original) Object.defineProperty(navigator, 'geolocation', original);
    else delete (navigator as any).geolocation;
  };
}

const pos = (lat: number, lng: number): GeolocationPosition =>
  ({ coords: { latitude: lat, longitude: lng, accuracy: 10 } }) as GeolocationPosition;

describe('isValidLatLng', () => {
  it('accepts real coordinates', () => {
    expect(isValidLatLng(28.6139, 77.209)).toBe(true);
    expect(isValidLatLng(-33.8688, 151.2093)).toBe(true);
    expect(isValidLatLng(0, 0)).toBe(true);
  });

  it('rejects out-of-range values', () => {
    expect(isValidLatLng(91, 0)).toBe(false);
    expect(isValidLatLng(-91, 0)).toBe(false);
    expect(isValidLatLng(0, 181)).toBe(false);
    expect(isValidLatLng(0, -181)).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(isValidLatLng('abc', 77)).toBe(false);
    expect(isValidLatLng(NaN, 77)).toBe(false);
    expect(isValidLatLng(undefined, undefined)).toBe(false);
  });

  it('accepts the boundaries', () => {
    expect(isValidLatLng(90, 180)).toBe(true);
    expect(isValidLatLng(-90, -180)).toBe(true);
  });
});

describe('resolveMapCenter', () => {
  it('uses browser geolocation when it succeeds', async () => {
    const restore = withGeolocation((ok) => ok(pos(12.9716, 77.5946)));
    try {
      const center = await resolveMapCenter();
      expect(center.lat).toBe(12.9716);
      expect(center.lng).toBe(77.5946);
    } finally {
      restore();
    }
  });

  it('falls back to Delhi when geolocation is denied', async () => {
    const restore = withGeolocation((_ok, fail) => fail?.({ code: 1 } as GeolocationPositionError));
    try {
      await expect(resolveMapCenter()).resolves.toEqual({ ...DELHI_CENTER });
    } finally {
      restore();
    }
  });

  it('falls back to Delhi when the reported position is out of range', async () => {
    const restore = withGeolocation((ok) => ok(pos(999, 999)));
    try {
      await expect(resolveMapCenter()).resolves.toEqual({ ...DELHI_CENTER });
    } finally {
      restore();
    }
  });

  it('falls back to Delhi when geolocation never calls back (timeout)', async () => {
    const restore = withGeolocation(() => {
      /* never resolves */
    });
    try {
      await expect(resolveMapCenter(50)).resolves.toEqual({ ...DELHI_CENTER });
    } finally {
      restore();
    }
  });

  it('returns a copy, so callers cannot mutate the shared constant', async () => {
    const center: MapCenter = await resolveMapCenter(10);
    center.lat = 0;
    expect(DELHI_CENTER.lat).toBe(28.6139);
  });
});

describe('invalidateMapSoon', () => {
  it('is a no-op returning a cleanup for a null map', () => {
    const cleanup = invalidateMapSoon(null);
    expect(typeof cleanup).toBe('function');
    expect(() => cleanup()).not.toThrow();
  });

  it('is a no-op when the map lacks invalidateSize', () => {
    const cleanup = invalidateMapSoon({});
    expect(() => cleanup()).not.toThrow();
  });

  it('schedules several invalidateSize calls', async () => {
    vi.useFakeTimers();
    try {
      const invalidateSize = vi.fn();
      const cleanup = invalidateMapSoon({ invalidateSize }, [0, 100]);
      vi.advanceTimersByTime(200);
      expect(invalidateSize).toHaveBeenCalledTimes(2);
      cleanup();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels pending calls when the cleanup runs', () => {
    vi.useFakeTimers();
    try {
      const invalidateSize = vi.fn();
      const cleanup = invalidateMapSoon({ invalidateSize }, [0, 100, 300]);
      cleanup();
      vi.advanceTimersByTime(1000);
      expect(invalidateSize).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('swallows an invalidateSize that throws', () => {
    vi.useFakeTimers();
    try {
      const cleanup = invalidateMapSoon(
        {
          invalidateSize: () => {
            throw new Error('detached map');
          },
        },
        [0],
      );
      expect(() => vi.advanceTimersByTime(10)).not.toThrow();
      cleanup();
    } finally {
      vi.useRealTimers();
    }
  });
});
