import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Test-only code is not product code. Stryker (ADR 0002) needs the same exclusion.
      exclude: ['src/**/*.test.ts', 'src/test-fixtures.ts'],
    },
  },
});
