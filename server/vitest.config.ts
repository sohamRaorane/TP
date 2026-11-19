import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // REST and socket suites share one Postgres test database
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 20_000,
    env: {
      NODE_ENV: 'test',
      TEST_DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? 'postgresql://sketch:sketch@localhost:5432/sketchboard_test',
    },
  },
});
