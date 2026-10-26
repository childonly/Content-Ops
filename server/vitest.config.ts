import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/services/base-data.service.ts', 'src/services/xhs-data.service.ts', 'src/services/youtube-data.service.ts'],
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
