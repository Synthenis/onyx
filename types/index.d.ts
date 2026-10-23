export type Primitive = string | number | boolean;

export type SignalRecord = Readonly<Record<string, Primitive>>;

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

export type AccountAgeBucket = 'unknown' | 'new' | 'recent' | 'established';

export interface ContextInput {
  now?: number | string | Date;
  timeZone?: string;
  surface?: string;
  language?: string;
  account?: { createdAt?: number | string | Date };
  user?: { state?: string; flags?: Record<string, boolean> };
  profile?: Record<string, Primitive | null | undefined>;
  signals?: Record<string, Primitive | null | undefined>;
}

export interface Context {
  readonly now: number;
  readonly surface: string | null;
  readonly language: string;
  readonly rtl: boolean;
  readonly time: Readonly<{ hour: number; weekday: number; weekend: boolean; dayPart: DayPart }>;
  readonly account: Readonly<{ ageDays: number | null; ageBucket: AccountAgeBucket }>;
  readonly user: Readonly<{ state: string | null; flags: Readonly<Record<string, boolean>> }>;
  readonly profile: SignalRecord;
  readonly signals: SignalRecord;
}

export interface Relevance {
  score: number;
  reasons?: readonly string[];
}

export interface SkillDefinition<P = unknown> {
  id: string;
  surfaces?: readonly string[];
  weight?: number;
  priority?: number;
  cooldownMs?: number;
  payload?: P;
  relevance(context: Context): number | Relevance;
  suggest?(context: Context): P;
}

export interface Skill<P = unknown> {
  readonly id: string;
  readonly surfaces: readonly string[] | null;
  readonly weight: number;
  readonly priority: number;
  readonly cooldownMs: number;
  readonly payload: P | null;
  readonly relevance: (context: Context) => number | Relevance;
  readonly suggest: ((context: Context) => P) | null;
}

export interface Suggestion<P = unknown> {
  readonly id: string;
  readonly rank: number;
  readonly score: number;
  readonly reasons: readonly string[];
  readonly payload: P;
}

export type TraceOutcome =
  | 'selected'
  | 'limit_exceeded'
  | 'below_threshold'
  | 'irrelevant'
  | 'surface_mismatch'
  | 'cooldown'
  | 'error';

export type TraceError = 'relevance_failed' | 'relevance_invalid' | 'suggest_failed';

export interface TraceEntry {
  readonly id: string;
  readonly outcome: TraceOutcome;
  readonly surface: boolean;
  readonly relevance: number;
  readonly reasons: readonly string[];
  readonly baseWeight: number;
  readonly adaptive: Readonly<{ net: number; multiplier: number }>;
  readonly score: number;
  readonly rank: number | null;
  readonly error: TraceError | null;
}

export interface SuggestOptions {
  surface?: string;
  limit?: number;
  minScore?: number;
  trace?: boolean;
}

export interface SuggestResult<P = unknown> {
  readonly at: number;
  readonly surface: string | null;
  readonly suggestions: readonly Suggestion<P>[];
  readonly trace?: readonly TraceEntry[];
}

export interface ExplainResult {
  readonly at: number;
  readonly surface: string | null;
  readonly trace: readonly TraceEntry[];
}

export interface FeedbackOptions {
  halfLifeMs?: number;
  scale?: number;
  range?: number;
  actions?: Record<string, number>;
  cooldownActions?: readonly string[];
  maxRecords?: number;
}

export interface FeedbackSnapshot {
  readonly pos: number;
  readonly neg: number;
  readonly net: number;
  readonly multiplier: number;
  readonly last: Readonly<{ action: string; at: number }> | null;
}

export interface StorageAdapter {
  readonly persistent?: boolean;
  load(): string | null;
  save(value: string): boolean | void;
  clear(): void;
}

export interface OnyxOptions {
  skills?: readonly (SkillDefinition | Skill)[];
  storage?: StorageAdapter;
  clock?: () => number;
  limit?: number;
  minScore?: number;
  feedback?: FeedbackOptions;
}

export interface Onyx {
  register<P = unknown>(skill: SkillDefinition<P> | Skill<P>): Skill<P>;
  unregister(id: string): boolean;
  skills(): string[];
  suggest<P = unknown>(context?: ContextInput, options?: SuggestOptions): SuggestResult<P>;
  explain(context?: ContextInput, options?: SuggestOptions): ExplainResult;
  feedback(id: string, action: string, options?: { at?: number }): FeedbackSnapshot;
  inspect(id: string): FeedbackSnapshot;
  reset(id?: string): boolean;
  exportState(): string;
  importState(text: string): boolean;
}

export class OnyxError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}

export function createOnyx(options?: OnyxOptions): Onyx;

export function defineSkill<P = unknown>(definition: SkillDefinition<P>): Skill<P>;

export function extractSignals(input: ContextInput | null | undefined, fallbackNow: number): Context;

export function createMemoryStorage(initial?: string | null): StorageAdapter;

export function createWebStorage(options?: { area?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>; key?: string }): StorageAdapter;
