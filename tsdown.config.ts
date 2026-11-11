import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  platform: 'neutral',
  fixedExtension: true,
  target: 'es2022',
  tsconfig: 'tsconfig.lib.json',
  dts: true,
  sourcemap: true,
  clean: true,
  publint: true,
  attw: { profile: 'node16' },
});
