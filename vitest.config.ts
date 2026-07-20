// ---
// 📚 WHY: Minimal Vitest configuration. Uses the TypeScript path resolver and
//    enables globals for describe/it/expect without importing them in every file.
// 📁 FILE: vitest.config.ts
// ---

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
    },
  },
});
