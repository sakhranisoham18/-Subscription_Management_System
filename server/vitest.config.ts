import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup-env.ts'],
    // integration tests share one database — run files sequentially
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
