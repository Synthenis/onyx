// © 2026 Synthenis. Released under the MIT License.

import { OnyxError } from './errors.js';
import { isValidId } from './ids.js';

const DAY_MS = 86400000;
const COUNTER_LIMIT = 1e6;
const DEFAULT_ACTIONS = Object.freeze({ accept: 1, dismiss: -1, ignore: -0.25 });
const DEFAULT_COOLDOWN_ACTIONS = Object.freeze(['accept', 'dismiss']);

const positive = (value, fallback, name) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || Number.isNaN(value) || value <= 0) {
    throw new OnyxError('feedback.invalid_option', `Feedback option "${name}" must be a positive number.`);
  }
  return value;
};

const resolveOptions = options => {
  const source = options !== null && typeof options === 'object' ? options : {};
  const actions = new Map(Object.entries(DEFAULT_ACTIONS));
  if (source.actions !== undefined) {
    if (source.actions === null || typeof source.actions !== 'object') {
      throw new OnyxError('feedback.invalid_actions', 'Feedback actions must be an object that maps identifiers to weights.');
    }
    for (const [name, weight] of Object.entries(source.actions)) {
      if (!isValidId(name) || typeof weight !== 'number' || !Number.isFinite(weight) || Math.abs(weight) > 8) {
        throw new OnyxError('feedback.invalid_actions', 'Each feedback action needs a valid identifier and a weight between -8 and 8.');
      }
      actions.set(name, weight);
    }
  }
  const cooldownActions = new Set(source.cooldownActions ?? DEFAULT_COOLDOWN_ACTIONS);
  for (const name of cooldownActions) {
    if (!actions.has(name)) {
      throw new OnyxError('feedback.invalid_option', 'Every cooldown action must also be a known feedback action.');
    }
  }
  const maxRecords = source.maxRecords ?? 512;
  if (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > 4096) {
    throw new OnyxError('feedback.invalid_option', 'Feedback option "maxRecords" must be an integer between 1 and 4096.');
  }
  return Object.freeze({
    halfLifeMs: positive(source.halfLifeMs, 14 * DAY_MS, 'halfLifeMs'),
    scale: positive(source.scale, 3, 'scale'),
    range: positive(source.range, 1, 'range'),
    actions,
    cooldownActions,
    maxRecords
  });
};

const decayed = (record, now, halfLifeMs) => {
  if (!(now > record.at) || halfLifeMs === Infinity) return { pos: record.pos, neg: record.neg };
  const factor = 0.5 ** ((now - record.at) / halfLifeMs);
  return { pos: record.pos * factor, neg: record.neg * factor };
};

export const createFeedbackModel = (options, initial) => {
  const settings = resolveOptions(options);
  const records = new Map(initial ?? []);

  const prune = () => {
    if (records.size <= settings.maxRecords) return;
    const oldest = [...records.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [id] of oldest) {
      if (records.size <= settings.maxRecords) break;
      records.delete(id);
    }
  };

  prune();

  const read = (id, now) => {
    const record = records.get(id);
    if (!record) return { pos: 0, neg: 0, net: 0, multiplier: 1, last: null };
    const { pos, neg } = decayed(record, now, settings.halfLifeMs);
    const net = pos - neg;
    return {
      pos,
      neg,
      net,
      multiplier: 2 ** (settings.range * Math.tanh(net / settings.scale)),
      last: record.last === null ? null : { action: record.last.action, at: record.last.at }
    };
  };

  const record = (id, action, now) => {
    if (!isValidId(id)) {
      throw new OnyxError('feedback.invalid_skill', 'A feedback target must be a valid skill identifier.');
    }
    if (!settings.actions.has(action)) {
      throw new OnyxError('feedback.unknown_action', `The feedback action "${String(action)}" is not defined.`);
    }
    const weight = settings.actions.get(action);
    const existing = records.get(id);
    const base = existing ? decayed(existing, now, settings.halfLifeMs) : { pos: 0, neg: 0 };
    records.set(id, {
      pos: Math.min(COUNTER_LIMIT, base.pos + Math.max(0, weight)),
      neg: Math.min(COUNTER_LIMIT, base.neg + Math.max(0, -weight)),
      at: existing ? Math.max(existing.at, now) : now,
      last: { action, at: now }
    });
    prune();
    return read(id, now);
  };

  return Object.freeze({
    read,
    record,
    isCooldownAction: action => settings.cooldownActions.has(action),
    forget: id => {
      if (id !== undefined) return records.delete(id);
      records.clear();
      return true;
    },
    replace: next => {
      records.clear();
      for (const [id, value] of next) records.set(id, value);
      prune();
    },
    entries: () => new Map(records)
  });
};
