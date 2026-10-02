import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    // Deliberately no setupFiles. vitest.setup.ts overwrites DATABASE_URL, which
    // breaks the suites that need a real database, so each test file establishes
    // its own environment in a vi.hoisted block before its imports. Adding it
    // globally here traded 11 failures in callBilling for the convenience of one
    // file, which is the wrong trade.
    testTimeout: 10000,
  },
});
