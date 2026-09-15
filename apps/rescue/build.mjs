import { cp, mkdir, rm } from 'node:fs/promises';
import { build } from 'esbuild';

const outputDirectory = 'dist';

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2023',
  minify: true,
  outfile: `${outputDirectory}/rescue.js`,
});

await cp('src/index.html', `${outputDirectory}/index.html`);

console.log(`Rescue page built into ${outputDirectory}. Serve it from anywhere.`);
