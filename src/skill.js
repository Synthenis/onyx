// © 2026 Synthenis. Released under the MIT License.

import { OnyxError } from './errors.js';
import { isValidId } from './ids.js';

const defined = new WeakSet();

const bounded = (value, fallback, min, max, name) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new OnyxError('skill.invalid_option', `Skill option "${name}" must be a number between ${min} and ${max}.`);
  }
  return value;
};

const normalizeSurfaces = value => {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length === 0 || !value.every(isValidId)) {
    throw new OnyxError('skill.invalid_surfaces', 'Skill surfaces must be a non-empty array of valid identifiers.');
  }
  return Object.freeze([...new Set(value)].sort());
};

export const defineSkill = spec => {
  if (defined.has(spec)) return spec;
  if (spec === null || typeof spec !== 'object') {
    throw new OnyxError('skill.invalid', 'A skill definition must be an object.');
  }
  if (!isValidId(spec.id)) {
    throw new OnyxError('skill.invalid_id', 'A skill identifier must match [a-z][a-z0-9._-]{0,63}.');
  }
  if (typeof spec.relevance !== 'function') {
    throw new OnyxError('skill.invalid_relevance', 'A skill must define a relevance function.');
  }
  if (spec.suggest !== undefined && typeof spec.suggest !== 'function') {
    throw new OnyxError('skill.invalid_suggest', 'A skill suggest option must be a function when provided.');
  }
  const priority = bounded(spec.priority, 0, -1000, 1000, 'priority');
  if (!Number.isInteger(priority)) {
    throw new OnyxError('skill.invalid_option', 'Skill option "priority" must be an integer.');
  }
  const skill = Object.freeze({
    id: spec.id,
    surfaces: normalizeSurfaces(spec.surfaces),
    weight: bounded(spec.weight, 1, 0.01, 4, 'weight'),
    priority,
    cooldownMs: bounded(spec.cooldownMs, 0, 0, 31536000000, 'cooldownMs'),
    payload: spec.payload === undefined ? null : spec.payload,
    relevance: spec.relevance,
    suggest: spec.suggest ?? null
  });
  defined.add(skill);
  return skill;
};

export const matchesSurface = (skill, surface) =>
  skill.surfaces === null || (surface !== null && skill.surfaces.includes(surface));
