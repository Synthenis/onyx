// © 2026 Synthenis. Released under the MIT License.

import { build } from 'esbuild';
import { readFile, rm } from 'node:fs/promises';

const LEGAL = '// © 2026 Synthenis. Released under the MIT License.';
const targets = [
  { outfile: 'dist/onyx.esm.min.js', format: 'esm' },
  { outfile: 'dist/onyx.min.js', format: 'iife', globalName: 'SynthenisOnyx' }
];

await rm('dist', { recursive: true, force: true });

for (const target of targets) {
  await build({
    entryPoints: ['src/index.js'],
    bundle: true,
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    target: 'es2020',
    banner: { js: LEGAL },
    ...target
  });
  const output = await readFile(target.outfile, 'utf8');
  if (!output.startsWith(LEGAL)) throw new Error(`${target.outfile} is missing the legal notice.`);
  if (/\b(console|fetch|XMLHttpRequest|WebSocket|sendBeacon|eval)\b/.test(output)) {
    throw new Error(`${target.outfile} contains a forbidden runtime reference.`);
  }
}
