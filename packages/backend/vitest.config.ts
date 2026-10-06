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
    // The default 10s hookTimeout assumes a quiet machine. These suites spawn
    // one isolated worker per file - 89 of them - each taking ~500ms to start,
    // and a `beforeAll` that merely does `await import(controller)` queues behind
    // all of that. It is contention during parallel startup, not a slow hook:
    // the same file runs in under 5s alone. Raised rather than lowering the
    // worker count, because a genuine hang is still caught here, just later.
    hookTimeout: 30000,
  },
});
