// © 2026 Synthenis. Released under the MIT License.

import { isValidId } from './ids.js';

const DAY_MS = 86400000;
const MAX_KEYS = 64;
const MAX_STRING = 128;
const KEY = /^[A-Za-z0-9_.:-]{1,64}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const RTL_LANGUAGES = new Set(['ar', 'he', 'fa', 'ur']);
const WEEKDAYS = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });
const formatters = new Map();

const toMillis = value => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  return Number.NaN;
};

const formatterFor = timeZone => {
  let formatter = formatters.get(timeZone);
  if (formatter) return formatter;
  formatter = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hourCycle: 'h23', weekday: 'short' });
  if (formatters.size >= 32) formatters.clear();
  formatters.set(timeZone, formatter);
  return formatter;
};

const clockParts = (ms, timeZone) => {
  let parts;
  try {
    parts = formatterFor(timeZone).formatToParts(ms);
  } catch {
    parts = formatterFor('UTC').formatToParts(ms);
  }
  let hour = 0;
  let weekday = 0;
  for (const part of parts) {
    if (part.type === 'hour') hour = Number.parseInt(part.value, 10) % 24;
    else if (part.type === 'weekday') weekday = WEEKDAYS[part.value] ?? 0;
  }
  return { hour, weekday };
};

const dayPartOf = hour => {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
};

const ageBucketOf = ageDays => {
  if (ageDays === null) return 'unknown';
  if (ageDays < 7) return 'new';
  if (ageDays < 90) return 'recent';
  return 'established';
};

const normalizeLanguage = value => {
  if (typeof value !== 'string') return 'und';
  const primary = value.trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(primary) ? primary : 'und';
};

const cleanRecord = (input, booleansOnly = false) => {
  const out = {};
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return Object.freeze(out);
  let count = 0;
  for (const key of Object.keys(input)) {
    if (count >= MAX_KEYS) break;
    if (FORBIDDEN_KEYS.has(key) || !KEY.test(key)) continue;
    const value = input[key];
    if (typeof value === 'boolean') out[key] = value;
    else if (booleansOnly) continue;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'string') out[key] = value.slice(0, MAX_STRING);
    else continue;
    count += 1;
  }
  return Object.freeze(out);
};

export const extractSignals = (input, fallbackNow) => {
  const source = input !== null && typeof input === 'object' ? input : {};
  const requested = toMillis(source.now);
  const now = Number.isFinite(requested) ? requested : fallbackNow;
  const timeZone = typeof source.timeZone === 'string' && source.timeZone.length <= 64 ? source.timeZone : 'UTC';
  const { hour, weekday } = clockParts(now, timeZone);
  const language = normalizeLanguage(source.language);
  const created = toMillis(source.account !== null && typeof source.account === 'object' ? source.account.createdAt : undefined);
  const ageDays = Number.isFinite(created) && now >= created ? Math.floor((now - created) / DAY_MS) : null;
  const user = source.user !== null && typeof source.user === 'object' ? source.user : {};
  return Object.freeze({
    now,
    surface: isValidId(source.surface) ? source.surface : null,
    language,
    rtl: RTL_LANGUAGES.has(language),
    time: Object.freeze({ hour, weekday, weekend: weekday === 0 || weekday === 6, dayPart: dayPartOf(hour) }),
    account: Object.freeze({ ageDays, ageBucket: ageBucketOf(ageDays) }),
    user: Object.freeze({ state: isValidId(user.state) ? user.state : null, flags: cleanRecord(user.flags, true) }),
    profile: cleanRecord(source.profile),
    signals: cleanRecord(source.signals)
  });
};
