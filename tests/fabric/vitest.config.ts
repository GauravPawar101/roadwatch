import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/fabric/**/*.test.ts'],
    globals: false,
    testTimeout: 120_000
  }
});
