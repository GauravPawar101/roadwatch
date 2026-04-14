import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false
  },
  coverage: {
    provider: 'v8',
    reportsDirectory: './coverage',
    reporter: ['text', 'html', 'lcov'],
    include: ['src/engines/**/*.ts'],
    exclude: ['src/**/*.test.ts']
  }
});
