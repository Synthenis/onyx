// © 2026 Synthenis. Released under the MIT License.

import { isValidId } from './ids.js';

const VERSION = 1;
const MAX_TEXT = 2000000;
const MAX_RECORDS = 4096;
const MAX_COUNTER = 1e6;
const MAX_TIME = 8.64e15;

const validNumber = (value, max) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;

const validRecord = raw =>
  raw !== null &&
  typeof raw === 'object' &&
  validNumber(raw.pos, MAX_COUNTER) &&
  validNumber(raw.neg, MAX_COUNTER) &&
  validNumber(raw.at, MAX_TIME) &&
  (raw.last === null ||
    (typeof raw.last === 'object' && isValidId(raw.last.action) && validNumber(raw.last.at, MAX_TIME)));

export const serializeState = records => JSON.stringify({ v: VERSION, records: Object.fromEntries(records) });

export const parseState = text => {
  if (typeof text !== 'string' || text.length === 0 || text.length > MAX_TEXT) return null;
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (data === null || typeof data !== 'object' || data.v !== VERSION) return null;
  if (data.records === null || typeof data.records !== 'object' || Array.isArray(data.records)) return null;
  const entries = Object.entries(data.records);
  if (entries.length > MAX_RECORDS) return null;
  const records = new Map();
  for (const [id, raw] of entries) {
    if (!isValidId(id) || !validRecord(raw)) return null;
    records.set(id, {
      pos: raw.pos,
      neg: raw.neg,
      at: raw.at,
      last: raw.last === null ? null : { action: raw.last.action, at: raw.last.at }
    });
  }
  return records;
};

export const createMemoryStorage = initial => {
  let value = typeof initial === 'string' ? initial : null;
  return Object.freeze({
    persistent: false,
    load: () => value,
    save: next => {
      value = next;
      return true;
    },
    clear: () => {
      value = null;
    }
  });
};

const defaultArea = () => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export const createWebStorage = options => {
  const source = options !== null && typeof options === 'object' ? options : {};
  const key = typeof source.key === 'string' && source.key.length > 0 && source.key.length <= 128 ? source.key : 'synthenis.onyx.state';
  const area = source.area ?? defaultArea();
  const usable =
    area !== null &&
    typeof area === 'object' &&
    typeof area.getItem === 'function' &&
    typeof area.setItem === 'function' &&
    typeof area.removeItem === 'function';
  if (!usable) return createMemoryStorage();
  return Object.freeze({
    persistent: true,
    load() {
      try {
        return area.getItem(key);
      } catch {
        return null;
      }
    },
    save(value) {
      try {
        area.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        area.removeItem(key);
      } catch {}
    }
  });
};
