import { defineConfig } from 'vitest/config';

/**
 * The scrapers decide what gets stored, so their mapping and parsing logic is
 * tested. Network access is never required: the tests exercise the mapping from
 * synthetic OSM elements, and the fetch layer is exercised against a real endpoint
 * by running the importer.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.mts'],
    globals: false,
  },
});
