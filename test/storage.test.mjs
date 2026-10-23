// © 2026 Synthenis. Released under the MIT License.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createOnyx, createMemoryStorage, createWebStorage } from '../src/index.js';

const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);
const skills = () => [
  { id: 'a', relevance: () => 0.5 },
  { id: 'b', relevance: () => 0.5 }
];

test('feedback persists across engine instances through shared storage', () => {
  const storage = createMemoryStorage();
  const first = createOnyx({ clock: () => T0, storage, skills: skills() });
  first.feedback('b', 'accept');
  const second = createOnyx({ clock: () => T0, storage, skills: skills() });
  assert.equal(second.inspect('b').net, 1);
  assert.deepEqual(second.suggest({}).suggestions.map(item => item.id), ['b', 'a']);
});

test('corrupt or foreign state starts empty', () => {
  const inputs = [
    'not json',
    '{}',
    '{"v":2,"records":{}}',
    '{"v":1,"records":[]}',
    '{"v":1,"records":{"Bad Id":{"pos":1,"neg":0,"at":1,"last":null}}}',
    '{"v":1,"records":{"a":{"pos":-1,"neg":0,"at":1,"last":null}}}',
    '{"v":1,"records":{"a":{"pos":1,"neg":0,"at":1,"last":{"action":"Bad","at":1}}}}',
    '{"v":1,"records":{"a":{"pos":"1","neg":0,"at":1,"last":null}}}',
    'x'.repeat(2000001)
  ];
  for (const input of inputs) {
    const engine = createOnyx({ clock: () => T0, storage: createMemoryStorage(input), skills: skills() });
    assert.equal(engine.inspect('a').net, 0, input.slice(0, 60));
  }
});

test('exportState and importState round-trip', () => {
  const source = createOnyx({ clock: () => T0, skills: skills() });
  source.feedback('a', 'accept');
  source.feedback('b', 'dismiss');
  const target = createOnyx({ clock: () => T0, skills: skills() });
  assert.equal(target.importState(source.exportState()), true);
  assert.deepEqual(target.inspect('a'), source.inspect('a'));
  assert.deepEqual(target.inspect('b'), source.inspect('b'));
});

test('importState rejects invalid input without changing state', () => {
  const engine = createOnyx({ clock: () => T0, skills: skills() });
  engine.feedback('a', 'accept');
  const before = engine.exportState();
  assert.equal(engine.importState('{"v":1,"records":{"a":{"pos":1e99,"neg":0,"at":1,"last":null}}}'), false);
  assert.equal(engine.importState(42), false);
  assert.equal(engine.exportState(), before);
});

test('importState persists to the storage adapter', () => {
  const storage = createMemoryStorage();
  const source = createOnyx({ clock: () => T0, skills: skills() });
  source.feedback('a', 'accept');
  const target = createOnyx({ clock: () => T0, storage, skills: skills() });
  target.importState(source.exportState());
  assert.equal(createOnyx({ clock: () => T0, storage, skills: skills() }).inspect('a').net, 1);
});

test('createWebStorage reads and writes through the provided area', () => {
  const data = new Map();
  const area = {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); }
  };
  const storage = createWebStorage({ area, key: 'test.state' });
  assert.equal(storage.persistent, true);
  assert.equal(storage.save('value'), true);
  assert.equal(data.get('test.state'), 'value');
  assert.equal(storage.load(), 'value');
  storage.clear();
  assert.equal(storage.load(), null);
});

test('createWebStorage survives a failing area', () => {
  const area = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('quota'); },
    removeItem: () => { throw new Error('blocked'); }
  };
  const storage = createWebStorage({ area });
  assert.equal(storage.load(), null);
  assert.equal(storage.save('value'), false);
  assert.doesNotThrow(() => storage.clear());
  const engine = createOnyx({ clock: () => T0, storage, skills: skills() });
  assert.doesNotThrow(() => engine.feedback('a', 'accept'));
});

test('createWebStorage falls back to memory when no usable area exists', () => {
  const storage = createWebStorage({ area: {} });
  assert.equal(storage.persistent, false);
  assert.equal(storage.save('value'), true);
  assert.equal(storage.load(), 'value');
});

test('createMemoryStorage accepts an initial string only', () => {
  assert.equal(createMemoryStorage('seed').load(), 'seed');
  assert.equal(createMemoryStorage(5).load(), null);
});
