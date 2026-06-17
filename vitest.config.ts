import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts', 'cli/**/*.ts'],
      exclude: [
        'src/extension.ts',
        'src/gutterProvider.ts',
        'src/hoverProvider.ts',
        'src/sidebarProvider.ts',
        'src/fileWatcher.ts',
      ],
    },
  },
});
