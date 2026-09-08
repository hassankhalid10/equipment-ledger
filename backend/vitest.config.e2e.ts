import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // A dedicated database, never the dev one seeded by `npm run seed` -
    // read-api.e2e-spec.ts wipes and reseeds core collections, which must
    // never touch the demo data a developer is looking at.
    env: { MONGODB_URI: 'mongodb://127.0.0.1:27017/equipment_ledger_test' },
    // Several files assert absolute counts against collections they wipe
    // and reseed themselves (read-api.e2e-spec.ts: exactly 60 assets, 3
    // keepers). Running files in parallel against the one shared test
    // database lets one file's fixtures leak into another's assertions.
    fileParallelism: false,
  },
});
