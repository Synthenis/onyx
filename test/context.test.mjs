// © 2026 Synthenis. Released under the MIT License.

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSignals } from '../src/index.js';

const NOW = Date.UTC(2026, 9, 23, 21, 30, 0);

test('extractSignals derives time signals in the requested time zone', () => {
  const istanbul = extractSignals({ timeZone: 'Europe/Istanbul' }, NOW);
  assert.equal(istanbul.time.hour, 0);
  assert.equal(istanbul.time.weekday, 6);
  assert.equal(istanbul.time.weekend, true);
  assert.equal(istanbul.time.dayPart, 'night');
  const utc = extractSignals({}, NOW);
  assert.equal(utc.time.hour, 21);
  assert.equal(utc.time.weekday, 5);
  assert.equal(utc.time.dayPart, 'evening');
});

test('extractSignals falls back to UTC for an invalid time zone', () => {
  const context = extractSignals({ timeZone: 'Not/AZone' }, NOW);
  assert.equal(context.time.hour, 21);
});

test('extractSignals prefers an explicit now', () => {
  const context = extractSignals({ now: '2026-01-05T09:00:00Z' }, NOW);
  assert.equal(context.now, Date.UTC(2026, 0, 5, 9));
  assert.equal(context.time.dayPart, 'morning');
});

test('extractSignals normalizes language and direction', () => {
  assert.equal(extractSignals({ language: 'tr-TR' }, NOW).language, 'tr');
  assert.equal(extractSignals({ language: 'AR_sa' }, NOW).rtl, true);
  assert.equal(extractSignals({ language: 'he' }, NOW).rtl, true);
  assert.equal(extractSignals({ language: 'en-US' }, NOW).rtl, false);
  assert.equal(extractSignals({ language: '123' }, NOW).language, 'und');
  assert.equal(extractSignals({}, NOW).language, 'und');
});

test('extractSignals buckets account age', () => {
  const day = 86400000;
  const age = createdAt => extractSignals({ account: { createdAt } }, NOW).account;
  assert.deepEqual(age(NOW - 2 * day), { ageDays: 2, ageBucket: 'new' });
  assert.deepEqual(age(NOW - 30 * day), { ageDays: 30, ageBucket: 'recent' });
  assert.deepEqual(age(NOW - 400 * day), { ageDays: 400, ageBucket: 'established' });
  assert.deepEqual(age(NOW + day), { ageDays: null, ageBucket: 'unknown' });
  assert.deepEqual(age('invalid'), { ageDays: null, ageBucket: 'unknown' });
  assert.deepEqual(extractSignals({}, NOW).account, { ageDays: null, ageBucket: 'unknown' });
});

test('extractSignals keeps only safe primitive records', () => {
  const profile = JSON.parse('{"__proto__":{"polluted":true},"constructor":"x","name":"a","count":3,"nan":null,"bad key":1,"flag":true,"nested":{"a":1}}');
  const context = extractSignals({ profile, signals: { score: Number.POSITIVE_INFINITY, ok: 'yes' } }, NOW);
  assert.deepEqual(context.profile, { name: 'a', count: 3, flag: true });
  assert.deepEqual(context.signals, { ok: 'yes' });
  assert.equal({}.polluted, undefined);
  assert.equal(Object.isFrozen(context.profile), true);
});

test('extractSignals limits string length and key count', () => {
  const many = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`k${index}`, index]));
  assert.equal(Object.keys(extractSignals({ signals: many }, NOW).signals).length, 64);
  assert.equal(extractSignals({ profile: { long: 'x'.repeat(500) } }, NOW).profile.long.length, 128);
});

test('extractSignals accepts only boolean user flags and valid user state', () => {
  const context = extractSignals({ user: { state: 'returning', flags: { a: true, b: 'yes', c: false } } }, NOW);
  assert.equal(context.user.state, 'returning');
  assert.deepEqual(context.user.flags, { a: true, c: false });
  assert.equal(extractSignals({ user: { state: 'Not Valid' } }, NOW).user.state, null);
});

test('extractSignals tolerates non-object input', () => {
  for (const input of [undefined, null, 'x', 4, []]) {
    const context = extractSignals(input, NOW);
    assert.equal(context.now, NOW);
    assert.equal(context.surface, null);
  }
});
