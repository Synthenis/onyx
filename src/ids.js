// © 2026 Synthenis. Released under the MIT License.

const PATTERN = /^[a-z][a-z0-9._-]{0,63}$/;

export const isValidId = value => typeof value === 'string' && PATTERN.test(value);
