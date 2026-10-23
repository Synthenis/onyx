// © 2026 Synthenis. Released under the MIT License.

import { OnyxError } from './errors.js';
import { isValidId } from './ids.js';
import { extractSignals } from './context.js';
import { createRegistry } from './registry.js';
import { createFeedbackModel } from './feedback.js';
import { matchesSurface } from './skill.js';
import { createMemoryStorage, parseState, serializeState } from './storage.js';

const REASON = /^[a-z][a-z0-9._-]{0,47}$/;
const MAX_REASONS = 8;

const integerOption = (value, fallback, min, max, name) => {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new OnyxError('options.invalid', `Option "${name}" must be an integer between ${min} and ${max}.`);
  }
  return value;
};

const numberOption = (value, fallback, min, max, name) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new OnyxError('options.invalid', `Option "${name}" must be a number between ${min} and ${max}.`);
  }
  return value;
};

const normalizeRelevance = value => {
  const raw = typeof value === 'number' ? { score: value } : value;
  if (raw === null || typeof raw !== 'object' || typeof raw.score !== 'number' || !Number.isFinite(raw.score)) return null;
  const reasons = Array.isArray(raw.reasons)
    ? raw.reasons.filter(reason => typeof reason === 'string' && REASON.test(reason)).slice(0, MAX_REASONS)
    : [];
  return { score: Math.min(1, Math.max(0, raw.score)), reasons };
};

const compareCandidates = (a, b) =>
  b.entry.score - a.entry.score || b.skill.priority - a.skill.priority || (a.skill.id < b.skill.id ? -1 : 1);

const freezeEntry = entry =>
  Object.freeze({
    ...entry,
    reasons: Object.freeze([...entry.reasons]),
    adaptive: Object.freeze({ ...entry.adaptive })
  });

const orderTrace = (a, b) => {
  if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
  if (a.rank !== null) return -1;
  if (b.rank !== null) return 1;
  return a.id < b.id ? -1 : 1;
};

export const createOnyx = options => {
  const config = options !== null && typeof options === 'object' ? options : {};
  const clock = config.clock ?? Date.now;
  if (typeof clock !== 'function') {
    throw new OnyxError('options.invalid', 'Option "clock" must be a function that returns a millisecond timestamp.');
  }
  const defaultLimit = integerOption(config.limit, 3, 1, 50, 'limit');
  const defaultMinScore = numberOption(config.minScore, 0.05, 0, 4, 'minScore');
  const storage = config.storage ?? createMemoryStorage();
  if (
    storage === null ||
    typeof storage !== 'object' ||
    typeof storage.load !== 'function' ||
    typeof storage.save !== 'function' ||
    typeof storage.clear !== 'function'
  ) {
    throw new OnyxError('options.invalid', 'Option "storage" must provide load, save and clear functions.');
  }
  const registry = createRegistry();
  const feedback = createFeedbackModel(config.feedback, parseState(storage.load()) ?? undefined);

  if (config.skills !== undefined) {
    if (!Array.isArray(config.skills)) {
      throw new OnyxError('options.invalid', 'Option "skills" must be an array of skill definitions.');
    }
    for (const skill of config.skills) registry.register(skill);
  }

  const readClock = () => {
    const value = clock();
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new OnyxError('clock.invalid', 'The clock must return a finite millisecond timestamp.');
    }
    return value;
  };

  const persist = () => {
    storage.save(serializeState(feedback.entries()));
  };

  const resolveCall = call => {
    const source = call !== null && typeof call === 'object' ? call : {};
    if (source.surface !== undefined && !isValidId(source.surface)) {
      throw new OnyxError('options.invalid', 'Option "surface" must be a valid identifier.');
    }
    return {
      surface: source.surface,
      limit: integerOption(source.limit, defaultLimit, 1, 50, 'limit'),
      minScore: numberOption(source.minScore, defaultMinScore, 0, 4, 'minScore'),
      trace: source.trace === true
    };
  };

  const evaluate = (input, call, build) => {
    const base = extractSignals(input, readClock());
    const surface = call.surface ?? base.surface;
    const view = Object.freeze({ ...base, surface });
    const items = [];

    for (const skill of registry.list()) {
      const state = feedback.read(skill.id, view.now);
      const entry = {
        id: skill.id,
        outcome: 'irrelevant',
        surface: matchesSurface(skill, surface),
        relevance: 0,
        reasons: [],
        baseWeight: skill.weight,
        adaptive: { net: state.net, multiplier: state.multiplier },
        score: 0,
        rank: null,
        error: null
      };
      items.push({ skill, entry });

      if (!entry.surface) {
        entry.outcome = 'surface_mismatch';
        continue;
      }
      const cooling =
        skill.cooldownMs > 0 &&
        state.last !== null &&
        feedback.isCooldownAction(state.last.action) &&
        view.now - state.last.at < skill.cooldownMs;
      if (cooling) {
        entry.outcome = 'cooldown';
        continue;
      }

      let result;
      try {
        result = normalizeRelevance(skill.relevance(view));
      } catch {
        entry.outcome = 'error';
        entry.error = 'relevance_failed';
        continue;
      }
      if (result === null) {
        entry.outcome = 'error';
        entry.error = 'relevance_invalid';
        continue;
      }
      entry.relevance = result.score;
      entry.reasons = result.reasons;
      if (result.score === 0) continue;
      entry.score = result.score * skill.weight * state.multiplier;
      entry.outcome = entry.score < call.minScore ? 'below_threshold' : 'candidate';
    }

    const selected = [];
    for (const item of items.filter(candidate => candidate.entry.outcome === 'candidate').sort(compareCandidates)) {
      if (selected.length >= call.limit) {
        item.entry.outcome = 'limit_exceeded';
        continue;
      }
      let payload = item.skill.payload;
      if (build && item.skill.suggest !== null) {
        try {
          payload = item.skill.suggest(view);
        } catch {
          item.entry.outcome = 'error';
          item.entry.error = 'suggest_failed';
          continue;
        }
      }
      item.entry.outcome = 'selected';
      item.entry.rank = selected.length + 1;
      selected.push(
        Object.freeze({
          id: item.skill.id,
          rank: item.entry.rank,
          score: item.entry.score,
          reasons: Object.freeze([...item.entry.reasons]),
          payload
        })
      );
    }

    return {
      at: view.now,
      surface,
      suggestions: Object.freeze(selected),
      trace: Object.freeze(items.map(item => freezeEntry(item.entry)).sort(orderTrace))
    };
  };

  const requireId = id => {
    if (!isValidId(id)) {
      throw new OnyxError('feedback.invalid_skill', 'A skill identifier must match [a-z][a-z0-9._-]{0,63}.');
    }
  };

  return Object.freeze({
    register: spec => registry.register(spec),
    unregister: id => registry.unregister(id),
    skills: () => registry.list().map(skill => skill.id).sort(),

    suggest(input, call) {
      const resolved = resolveCall(call);
      const { at, surface, suggestions, trace } = evaluate(input, resolved, true);
      return Object.freeze(resolved.trace ? { at, surface, suggestions, trace } : { at, surface, suggestions });
    },

    explain(input, call) {
      const { at, surface, trace } = evaluate(input, resolveCall(call), false);
      return Object.freeze({ at, surface, trace });
    },

    feedback(id, action, call) {
      requireId(id);
      const at = call !== null && typeof call === 'object' && call.at !== undefined ? call.at : readClock();
      if (typeof at !== 'number' || !Number.isFinite(at)) {
        throw new OnyxError('options.invalid', 'Option "at" must be a finite millisecond timestamp.');
      }
      const snapshot = feedback.record(id, action, at);
      persist();
      return Object.freeze(snapshot);
    },

    inspect(id) {
      requireId(id);
      return Object.freeze(feedback.read(id, readClock()));
    },

    reset(id) {
      if (id !== undefined) requireId(id);
      const removed = feedback.forget(id);
      persist();
      return removed;
    },

    exportState: () => serializeState(feedback.entries()),

    importState(text) {
      const records = parseState(text);
      if (records === null) return false;
      feedback.replace(records);
      persist();
      return true;
    }
  });
};
