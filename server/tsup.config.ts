import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  // The shared workspace ships TypeScript source, so it must be bundled in.
  noExternal: ['@waypoint/shared'],
});
