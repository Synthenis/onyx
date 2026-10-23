# Synthenis Onyx

Synthenis Onyx is an adaptive engine for contextual suggestions, predictive UI and personalized hints in web products. It is not a language model and does not use a neural network. It decides with composable skills, weighted signals and per-user feedback, and it can explain every decision it makes.

This repository contains the Open Source edition under the MIT License.

## Properties

- Dependency-free JavaScript for browsers, Node.js 18 or later, and edge runtimes.
- Client-side by design. The library contains no network code. The only environment access is the storage adapter you supply, or the browser `localStorage` when you use `createWebStorage`.
- Deterministic. The same context, skills, feedback state and clock always produce the same result.
- Explainable. A reasoning trace reports the outcome and the numbers behind every skill.
- Headless. Onyx returns identifiers and payload data. It never produces visible text, so all copy, localization and rendering stay in your application.

## Installation

```sh
npm install synthenis-onyx
```

Standalone builds are produced by `npm run build` in `dist/onyx.esm.min.js` and `dist/onyx.min.js` (global `SynthenisOnyx`).

## Quick start

```js
import { createOnyx, createWebStorage, defineSkill } from 'synthenis-onyx';

const onyx = createOnyx({
  storage: createWebStorage(),
  skills: [
    defineSkill({
      id: 'profile.add_avatar',
      surfaces: ['dashboard'],
      cooldownMs: 7 * 24 * 60 * 60 * 1000,
      relevance: context =>
        context.profile.hasAvatar === false
          ? { score: 0.8, reasons: ['profile.avatar_missing'] }
          : 0,
      payload: { action: 'open_profile' }
    }),
    defineSkill({
      id: 'account.review_security',
      surfaces: ['dashboard', 'settings'],
      relevance: context =>
        context.account.ageBucket === 'established' ? 0.5 : 0.1,
      payload: { action: 'open_security' }
    })
  ]
});

const { suggestions } = onyx.suggest({
  surface: 'dashboard',
  language: 'tr-TR',
  timeZone: 'Europe/Istanbul',
  account: { createdAt: '2026-01-23T00:00:00Z' },
  profile: { hasAvatar: false }
});

onyx.feedback(suggestions[0].id, 'accept');
```

## Concepts

### Context

`suggest` accepts a plain object and converts it into a frozen, validated context through signal extraction. Unknown keys are ignored. Profile and signal records keep only booleans, finite numbers and strings of at most 128 characters, with at most 64 keys, and they discard `__proto__`, `constructor` and `prototype`.

| Field | Source | Result |
| --- | --- | --- |
| `now` | number, ISO string or `Date` | Milliseconds since the epoch. Defaults to the engine clock. |
| `timeZone` | IANA name | `time.hour`, `time.weekday`, `time.weekend`, `time.dayPart`. Invalid names fall back to UTC. |
| `language` | BCP 47 tag | Lowercase primary subtag in `language`, or `und`. `rtl` is true for `ar`, `he`, `fa` and `ur`. |
| `account.createdAt` | timestamp | `account.ageDays` and `account.ageBucket`: `new` under 7 days, `recent` under 90, `established` otherwise, `unknown` when absent or in the future. |
| `user.state`, `user.flags` | identifier, booleans | `user.state` and `user.flags`. |
| `profile`, `signals` | primitive records | Sanitized copies. |
| `surface` | identifier | The surface being rendered. |

### Skills

A skill is a small unit that knows when it is relevant and what it would suggest.

| Option | Default | Description |
| --- | --- | --- |
| `id` | required | Matches `[a-z][a-z0-9._-]{0,63}`. |
| `relevance(context)` | required | Returns a number or `{ score, reasons }`. The score is clamped to 0 through 1. Reasons are machine codes matching `[a-z][a-z0-9._-]{0,47}`, at most 8. |
| `surfaces` | all | Surfaces where the skill may appear. |
| `weight` | `1` | Static multiplier from 0.01 to 4. |
| `priority` | `0` | Integer tie-breaker from -1000 to 1000. |
| `cooldownMs` | `0` | Suppression period after an `accept` or `dismiss`. |
| `payload` | `null` | Static data returned with the suggestion. |
| `suggest(context)` | none | Builds the payload at selection time. Overrides `payload`. |

### Scoring

For each skill on the requested surface that is not cooling down:

```
score = relevance × weight × adaptive multiplier
```

Skills with a score below `minScore` (default `0.05`) are dropped. The remaining skills are ordered by score, then `priority`, then identifier, and the first `limit` (default `3`) are returned. A skill that throws or returns an invalid value is excluded and recorded in the trace. It never breaks the other skills.

### Feedback and decay

`onyx.feedback(id, action)` records what the user did with a suggestion. Built-in actions are `accept` (+1), `dismiss` (-1) and `ignore` (-0.25). Positive and negative evidence decays exponentially with a half-life of 14 days. The adaptive multiplier is:

```
multiplier = 2 ^ (range × tanh(net / scale))
```

With the defaults `range = 1` and `scale = 3` the multiplier stays between 0.5 and 2 and equals 1 without evidence. Configure it with the `feedback` option:

```js
createOnyx({
  feedback: {
    halfLifeMs: 7 * 24 * 60 * 60 * 1000,
    scale: 3,
    range: 1,
    actions: { pin: 3 },
    cooldownActions: ['accept', 'dismiss', 'pin'],
    maxRecords: 512
  }
});
```

### Reasoning trace

`onyx.suggest(context, { trace: true })` adds a `trace` array. `onyx.explain(context)` returns the same trace without building payloads or changing any state. Each entry contains:

| Field | Description |
| --- | --- |
| `id` | Skill identifier. |
| `outcome` | `selected`, `limit_exceeded`, `below_threshold`, `irrelevant`, `surface_mismatch`, `cooldown` or `error`. |
| `surface` | Whether the skill applies to the surface. |
| `relevance`, `reasons` | Result of the relevance function. |
| `baseWeight` | Static skill weight. |
| `adaptive` | `{ net, multiplier }` from feedback. |
| `score`, `rank` | Final score and position among selected skills. |
| `error` | `relevance_failed`, `relevance_invalid`, `suggest_failed` or `null`. |

Selected entries come first in rank order, followed by the remaining skills by identifier.

### Persistence

Feedback state is serialized as versioned JSON and written through a storage adapter after every `feedback`, `reset` and `importState` call. An adapter provides `load()`, `save(value)` and `clear()`, all synchronous.

- `createMemoryStorage(initial?)` keeps state in memory.
- `createWebStorage({ area?, key? })` uses `localStorage` or any object with `getItem`, `setItem` and `removeItem`. It falls back to memory when no usable area exists, and it never throws on blocked or full storage.

State that fails validation is ignored in full and the engine starts empty. `exportState()` and `importState(text)` let an application move state between devices on the user's initiative. `importState` returns `false` and changes nothing when the input is invalid.

## API

| Function | Description |
| --- | --- |
| `createOnyx(options?)` | Creates an engine. Options: `skills`, `storage`, `clock`, `limit`, `minScore`, `feedback`. |
| `defineSkill(definition)` | Validates a definition and returns a frozen skill. |
| `extractSignals(input, fallbackNow)` | Builds the frozen context used by skills. |
| `createMemoryStorage(initial?)` | In-memory storage adapter. |
| `createWebStorage(options?)` | Web storage adapter. |
| `OnyxError` | Error class with a stable `code` property. |

Engine methods: `register`, `unregister`, `skills`, `suggest`, `explain`, `feedback`, `inspect`, `reset`, `exportState`, `importState`. TypeScript declarations are in `types/index.d.ts`.

## Scope of this edition

The Open Source edition contains the skill registry, the scoring loop, per-user feedback, decay, signal extraction and the reasoning trace. Capabilities that belong to the Synthenis Internal edition are not part of this repository.

## Development

```sh
npm ci
npm test
npm run build
```

The test suite also checks repository conventions: every JavaScript file carries the legal notice, source files contain no code comments, no network or logging APIs, and no runtime dependencies.

## License

MIT. See `LICENSE`.
