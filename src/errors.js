// © 2026 Synthenis. Released under the MIT License.

export class OnyxError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OnyxError';
    this.code = code;
  }
}
