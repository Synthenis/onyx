// © 2026 Synthenis. Released under the MIT License.

import { OnyxError } from './errors.js';
import { defineSkill } from './skill.js';

export const createRegistry = () => {
  const skills = new Map();
  return Object.freeze({
    register(spec) {
      const skill = defineSkill(spec);
      if (skills.has(skill.id)) {
        throw new OnyxError('registry.duplicate', `A skill with the identifier "${skill.id}" is already registered.`);
      }
      skills.set(skill.id, skill);
      return skill;
    },
    unregister: id => skills.delete(id),
    get: id => skills.get(id) ?? null,
    has: id => skills.has(id),
    list: () => [...skills.values()]
  });
};
