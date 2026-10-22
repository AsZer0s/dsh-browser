import { build } from 'esbuild'

await build({
  entryPoints: ['src/index.ts'], outfile: 'lib/index.js', bundle: true,
  platform: 'node', format: 'esm', target: 'node22', packages: 'external', sourcemap: true,
})
await build({
  entryPoints: ['src/client.js'], outfile: 'client.js', bundle: true,
  platform: 'browser', format: 'iife', target: 'es2022',
  loader: { '.css': 'text' },
})
