// © 2026 Synthenis. Released under the MIT License.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const HEADER = '// © 2026 Synthenis. Released under the MIT License.';
const root = new URL('..', import.meta.url).pathname;
const read = path => readFileSync(join(root, path), 'utf8');
const listing = directory => readdirSync(join(root, directory)).filter(name => /\.m?js$/.test(name)).map(name => `${directory}/${name}`);

const sources = listing('src');
const all = [...sources, ...listing('scripts'), ...listing('test')];

test('every JavaScript file starts with the legal notice', () => {
  for (const path of all) assert.equal(read(path).split('\n')[0], HEADER, path);
});

test('source and scripts contain no code comments beyond the legal notice', () => {
  for (const path of [...sources, ...listing('scripts')]) {
    const body = read(path).split('\n').slice(1).join('\n');
    assert.equal(/(^|[^:'"`])\/\/|\/\*/.test(body), false, path);
  }
});

test('source performs no network access, dynamic evaluation or logging', () => {
  const forbidden = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|eval|console|debugger)\b|new Function|\bimport\(|\brequire\(/;
  for (const path of sources) assert.equal(forbidden.test(read(path)), false, path);
});

test('source imports only from within the package', () => {
  for (const path of sources) {
    for (const match of read(path).matchAll(/from '([^']+)'/g)) assert.ok(match[1].startsWith('./'), `${path}: ${match[1]}`);
  }
});

test('the package has no runtime dependencies and a permissive license', () => {
  const manifest = JSON.parse(read('package.json'));
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.license, 'MIT');
  assert.match(read('LICENSE'), /^MIT License/);
});
