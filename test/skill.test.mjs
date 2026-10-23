// © 2026 Synthenis. Released under the MIT License.

import test from 'node:test';
import assert from 'node:assert/strict';
import { defineSkill, OnyxError } from '../src/index.js';

const relevance = () => 1;

test('defineSkill returns a frozen skill with defaults', () => {
  const skill = defineSkill({ id: 'profile.complete', relevance });
  assert.equal(skill.id, 'profile.complete');
  assert.equal(skill.weight, 1);
  assert.equal(skill.priority, 0);
  assert.equal(skill.cooldownMs, 0);
  assert.equal(skill.surfaces, null);
  assert.equal(skill.payload, null);
  assert.equal(Object.isFrozen(skill), true);
});

test('defineSkill is idempotent for defined skills', () => {
  const skill = defineSkill({ id: 'a', relevance });
  assert.equal(defineSkill(skill), skill);
});

test('defineSkill deduplicates and sorts surfaces', () => {
  const skill = defineSkill({ id: 'a', relevance, surfaces: ['settings', 'dashboard', 'settings'] });
  assert.deepEqual(skill.surfaces, ['dashboard', 'settings']);
});

test('defineSkill rejects invalid definitions', () => {
  const invalid = [
    null,
    'skill',
    { relevance },
    { id: 'Bad Id', relevance },
    { id: '__proto__', relevance },
    { id: 'a' },
    { id: 'a', relevance, suggest: 'no' },
    { id: 'a', relevance, surfaces: [] },
    { id: 'a', relevance, surfaces: ['Bad'] },
    { id: 'a', relevance, weight: 0 },
    { id: 'a', relevance, weight: 5 },
    { id: 'a', relevance, weight: Number.NaN },
    { id: 'a', relevance, priority: 1.5 },
    { id: 'a', relevance, cooldownMs: -1 }
  ];
  for (const spec of invalid) {
    assert.throws(() => defineSkill(spec), error => error instanceof OnyxError, JSON.stringify(spec));
  }
});
