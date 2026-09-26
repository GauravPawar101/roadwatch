import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Node >= 22 exposes a native `localStorage` global that stays disabled unless
// --localstorage-file is passed, and it shadows jsdom's implementation. Always
// go through `window.localStorage` (jsdom's) and tolerate its absence.
function storage(): Storage | null {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

afterEach(() => {
  cleanup();
  storage()?.clear();
  vi.restoreAllMocks();
});

// jsdom does not implement these; several components call them on mount.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (!('ResizeObserver' in window)) {
  (window as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!('scrollTo' in window)) {
  (window as any).scrollTo = () => {};
}
