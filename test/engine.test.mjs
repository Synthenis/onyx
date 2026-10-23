// © 2026 Synthenis. Released under the MIT License.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createOnyx, defineSkill, OnyxError } from '../src/index.js';

const T0 = Date.UTC(2026, 9, 23, 12, 0, 0);
const DAY = 86400000;

const make = (overrides = {}) => {
  let now = T0;
  const engine = createOnyx({ clock: () => now, ...overrides });
  return { engine, advance: ms => { now += ms; }, set: value => { now = value; } };
};

const skill = (id, score, extra = {}) => ({ id, relevance: () => score, payload: { id }, ...extra });

test('suggest ranks by score, then priority, then identifier', () => {
  const { engine } = make({
    skills: [skill('c', 0.5), skill('b', 0.5), skill('a', 0.5, { priority: 1 }), skill('d', 0.9), skill('e', 0.3)],
    limit: 10
  });
  const result = engine.suggest({});
  assert.deepEqual(result.suggestions.map(item => item.id), ['d', 'a', 'b', 'c', 'e']);
  assert.deepEqual(result.suggestions.map(item => item.rank), [1, 2, 3, 4, 5]);
});

test('suggest applies limit and minScore', () => {
  const { engine } = make({ skills: [skill('a', 0.9), skill('b', 0.8), skill('c', 0.7), skill('d', 0.6), skill('e', 0.01)] });
  assert.equal(engine.suggest({}).suggestions.length, 3);
  assert.equal(engine.suggest({}, { limit: 1 }).suggestions.length, 1);
  assert.deepEqual(engine.suggest({}, { limit: 10, minScore: 0.65 }).suggestions.map(item => item.id), ['a', 'b', 'c']);
  const trace = engine.suggest({}, { limit: 10, trace: true }).trace;
  assert.equal(trace.find(entry => entry.id === 'e').outcome, 'below_threshold');
});

test('suggest filters by surface', () => {
  const { engine } = make({
    skills: [skill('a', 0.9, { surfaces: ['dashboard'] }), skill('b', 0.8, { surfaces: ['settings'] }), skill('c', 0.7)]
  });
  assert.deepEqual(engine.suggest({ surface: 'dashboard' }).suggestions.map(item => item.id), ['a', 'c']);
  assert.deepEqual(engine.suggest({}, { surface: 'settings' }).suggestions.map(item => item.id), ['b', 'c']);
  assert.deepEqual(engine.suggest({}).suggestions.map(item => item.id), ['c']);
});

test('suggest passes a frozen context and builds payloads', () => {
  const seen = [];
  const { engine } = make({
    skills: [
      {
        id: 'a',
        relevance: context => {
          seen.push(context);
          return { score: context.profile.ready === true ? 1 : 0, reasons: ['profile.ready', 'Bad Reason'] };
        },
        suggest: context => ({ language: context.language })
      }
    ]
  });
  const result = engine.suggest({ language: 'tr-TR', profile: { ready: true } });
  assert.deepEqual(result.suggestions[0].payload, { language: 'tr' });
  assert.deepEqual(result.suggestions[0].reasons, ['profile.ready']);
  assert.equal(Object.isFrozen(seen[0]), true);
  assert.equal(engine.suggest({ profile: { ready: false } }).suggestions.length, 0);
});

test('suggest isolates failing skills', () => {
  const { engine } = make({
    skills: [
      { id: 'throws', relevance: () => { throw new Error('boom'); } },
      { id: 'invalid', relevance: () => 'high' },
      { id: 'nan', relevance: () => Number.NaN },
      { id: 'late', relevance: () => 0.9, suggest: () => { throw new Error('boom'); } },
      skill('ok', 0.5)
    ]
  });
  const result = engine.suggest({}, { trace: true });
  assert.deepEqual(result.suggestions.map(item => item.id), ['ok']);
  const byId = Object.fromEntries(result.trace.map(entry => [entry.id, entry]));
  assert.equal(byId.throws.error, 'relevance_failed');
  assert.equal(byId.invalid.error, 'relevance_invalid');
  assert.equal(byId.nan.error, 'relevance_invalid');
  assert.equal(byId.late.error, 'suggest_failed');
  assert.equal(byId.late.outcome, 'error');
});

test('a failing suggest does not consume a slot', () => {
  const { engine } = make({
    skills: [{ id: 'a', relevance: () => 1, suggest: () => { throw new Error('boom'); } }, skill('b', 0.5), skill('c', 0.4)],
    limit: 2
  });
  assert.deepEqual(engine.suggest({}).suggestions.map(item => item.id), ['b', 'c']);
});

test('relevance is clamped to the unit interval', () => {
  const { engine } = make({ skills: [skill('high', 7), skill('low', -3)] });
  const result = engine.suggest({}, { trace: true });
  assert.equal(result.suggestions[0].score, 1);
  assert.equal(result.trace.find(entry => entry.id === 'low').outcome, 'irrelevant');
});

test('skill weight scales the score', () => {
  const { engine } = make({ skills: [skill('a', 0.5, { weight: 2 }), skill('b', 0.8)] });
  assert.deepEqual(engine.suggest({}).suggestions.map(item => item.id), ['a', 'b']);
});

test('suggest is deterministic for identical input and clock', () => {
  const { engine } = make({ skills: [skill('a', 0.5), skill('b', 0.5), skill('c', 0.2)] });
  const input = { surface: 'dashboard', language: 'de', profile: { x: 1 } };
  assert.deepEqual(engine.suggest(input, { trace: true }), engine.suggest(input, { trace: true }));
});

test('register, unregister and duplicates', () => {
  const { engine } = make();
  engine.register(skill('a', 1));
  assert.deepEqual(engine.skills(), ['a']);
  assert.throws(() => engine.register(skill('a', 1)), error => error.code === 'registry.duplicate');
  assert.equal(engine.unregister('a'), true);
  assert.equal(engine.unregister('a'), false);
  assert.deepEqual(engine.skills(), []);
});

test('createOnyx validates options', () => {
  const invalid = [
    { clock: 'now' },
    { limit: 0 },
    { limit: 1.5 },
    { minScore: -1 },
    { storage: {} },
    { skills: 'a' },
    { skills: [{ id: 'a' }] },
    { feedback: { halfLifeMs: 0 } },
    { feedback: { actions: { 'Bad Name': 1 } } },
    { feedback: { cooldownActions: ['unknown'] } }
  ];
  for (const options of invalid) {
    assert.throws(() => createOnyx(options), error => error instanceof OnyxError, JSON.stringify(options));
  }
  assert.doesNotThrow(() => createOnyx(null));
});

test('suggest rejects invalid call options and clocks', () => {
  const { engine } = make({ skills: [skill('a', 1)] });
  assert.throws(() => engine.suggest({}, { surface: 'Bad' }), OnyxError);
  assert.throws(() => engine.suggest({}, { limit: 100 }), OnyxError);
  const broken = createOnyx({ clock: () => Number.NaN, skills: [skill('a', 1)] });
  assert.throws(() => broken.suggest({}), error => error.code === 'clock.invalid');
});

test('explain reports every skill without building payloads or changing state', () => {
  let built = 0;
  const { engine } = make({
    skills: [
      { id: 'a', relevance: () => 0.9, suggest: () => { built += 1; return 1; } },
      skill('b', 0.5, { surfaces: ['settings'] }),
      skill('c', 0)
    ]
  });
  const before = engine.exportState();
  const explained = engine.explain({ surface: 'dashboard' });
  assert.equal(built, 0);
  assert.equal(engine.exportState(), before);
  const byId = Object.fromEntries(explained.trace.map(entry => [entry.id, entry.outcome]));
  assert.deepEqual(byId, { a: 'selected', b: 'surface_mismatch', c: 'irrelevant' });
  assert.equal(explained.trace[0].id, 'a');
});

test('suggest trace matches explain trace', () => {
  const { engine } = make({ skills: [skill('a', 0.9), skill('b', 0.4, { surfaces: ['x'] })] });
  assert.deepEqual(engine.suggest({}, { trace: true }).trace, engine.explain({}).trace);
  assert.equal('trace' in engine.suggest({}), false);
});

test('trace entries expose adaptive state', () => {
  const { engine } = make({ skills: [skill('a', 0.5)] });
  engine.feedback('a', 'accept');
  const entry = engine.explain({}).trace[0];
  assert.ok(entry.adaptive.multiplier > 1);
  assert.equal(entry.adaptive.net, 1);
  assert.equal(entry.baseWeight, 1);
  assert.equal(Object.isFrozen(entry), true);
});

test('limit_exceeded is reported for ranked candidates beyond the limit', () => {
  const { engine } = make({ skills: [skill('a', 0.9), skill('b', 0.8), skill('c', 0.7)] });
  const trace = engine.explain({}, { limit: 1 }).trace;
  assert.deepEqual(trace.map(entry => entry.outcome), ['selected', 'limit_exceeded', 'limit_exceeded']);
});

test('feedback changes ranking and decays over time', () => {
  const { engine, advance } = make({ skills: [skill('a', 0.5), skill('b', 0.5)] });
  assert.deepEqual(engine.suggest({}).suggestions.map(item => item.id), ['a', 'b']);
  engine.feedback('b', 'accept');
  engine.feedback('b', 'accept');
  assert.deepEqual(engine.suggest({}).suggestions.map(item => item.id), ['b', 'a']);
  const fresh = engine.inspect('b');
  advance(14 * DAY);
  const halved = engine.inspect('b');
  assert.ok(Math.abs(halved.net - fresh.net / 2) < 1e-9);
  advance(14 * DAY * 40);
  assert.ok(Math.abs(engine.inspect('b').multiplier - 1) < 1e-6);
});

test('multiplier stays within the configured bounds', () => {
  const { engine } = make({ skills: [skill('a', 1)] });
  for (let index = 0; index < 200; index += 1) engine.feedback('a', 'accept');
  const high = engine.inspect('a').multiplier;
  assert.ok(high <= 2 && high > 1.99);
  for (let index = 0; index < 600; index += 1) engine.feedback('a', 'dismiss');
  const low = engine.inspect('a').multiplier;
  assert.ok(low >= 0.5 && low < 0.51);
});

test('ignore has a smaller effect than dismiss', () => {
  const { engine } = make({ skills: [skill('a', 1), skill('b', 1)] });
  engine.feedback('a', 'ignore');
  engine.feedback('b', 'dismiss');
  assert.ok(engine.inspect('a').multiplier > engine.inspect('b').multiplier);
  assert.ok(engine.inspect('a').multiplier < 1);
});

test('custom feedback actions and unknown actions', () => {
  const { engine } = make({ skills: [skill('a', 1)], feedback: { actions: { pin: 3 } } });
  assert.ok(Math.abs(engine.feedback('a', 'pin').multiplier - 2 ** Math.tanh(1)) < 1e-9);
  assert.throws(() => engine.feedback('a', 'applaud'), error => error.code === 'feedback.unknown_action');
  assert.throws(() => engine.feedback('constructor', 'toString'), error => error.code === 'feedback.unknown_action');
  assert.throws(() => engine.feedback('Bad Id', 'accept'), error => error.code === 'feedback.invalid_skill');
});

test('cooldown suppresses a skill after a terminal action', () => {
  const { engine, advance } = make({ skills: [skill('a', 1, { cooldownMs: DAY })] });
  assert.equal(engine.suggest({}).suggestions.length, 1);
  engine.feedback('a', 'dismiss');
  assert.equal(engine.suggest({}).suggestions.length, 0);
  assert.equal(engine.explain({}).trace[0].outcome, 'cooldown');
  advance(DAY - 1);
  assert.equal(engine.suggest({}).suggestions.length, 0);
  advance(1);
  assert.equal(engine.suggest({}).suggestions.length, 1);
});

test('ignore does not trigger a cooldown by default', () => {
  const { engine } = make({ skills: [skill('a', 1, { cooldownMs: DAY })] });
  engine.feedback('a', 'ignore');
  assert.equal(engine.suggest({}).suggestions.length, 1);
});

test('feedback accepts an explicit timestamp', () => {
  const { engine } = make({ skills: [skill('a', 1)] });
  engine.feedback('a', 'accept', { at: T0 - 14 * DAY });
  assert.ok(Math.abs(engine.inspect('a').net - 0.5) < 1e-9);
  assert.throws(() => engine.feedback('a', 'accept', { at: Number.NaN }), OnyxError);
});

test('reset removes one record or all records', () => {
  const { engine } = make({ skills: [skill('a', 1), skill('b', 1)] });
  engine.feedback('a', 'accept');
  engine.feedback('b', 'accept');
  assert.equal(engine.reset('a'), true);
  assert.equal(engine.inspect('a').net, 0);
  assert.equal(engine.inspect('b').net, 1);
  engine.reset();
  assert.equal(engine.inspect('b').net, 0);
});

test('old records are pruned beyond maxRecords', () => {
  const { engine, advance } = make({ feedback: { maxRecords: 2 } });
  engine.feedback('a', 'accept');
  advance(1000);
  engine.feedback('b', 'accept');
  advance(1000);
  engine.feedback('c', 'accept');
  assert.equal(engine.inspect('a').net, 0);
  assert.ok(engine.inspect('b').net > 0);
  assert.ok(engine.inspect('c').net > 0);
});
