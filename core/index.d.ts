export interface AssistantEvent { id: string; scope: string; type: string; at: number; data?: JsonValue }
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface Suggestion {
  id: string; title: string; message: string; evidence?: string; priority?: number; urgent?: boolean;
  createdAt?: number; expiresAt: number; cooldownKey?: string; cooldownMs?: number;
}
export type Decision = { mode: 'observe' } | { mode: 'remember'; memory: JsonValue } | { mode: 'suggest'; suggestions: Suggestion[] };
export interface Context { readonly scope: string; readonly at: number; readonly events: readonly AssistantEvent[]; readonly memory: JsonValue }
export type Provider = (context: Context, options: { signal: AbortSignal }) => Decision | Promise<Decision>;
export type Feedback = 'adopted' | 'rejected' | 'dismissed';
export interface Diagnostic { sequence: number; at: number; stage: string; code: string; ref?: string }
export interface QueueSnapshot { paused: boolean; current: Suggestion | null; pending: Suggestion[]; history: { id: string; state: string; at: number }[] }
export interface Evaluation { status: 'completed' | 'cancelled' | 'failed' | 'timeout' | 'invalid' | 'unavailable'; mode?: Decision['mode'] }
export interface Runtime {
  start(scope: string): void; stop(): void; dispose(): void;
  ingest(event: AssistantEvent): boolean; evaluate(): Promise<Evaluation>;
  present(): Suggestion | null; decide(id: string, value: Feedback): boolean;
  pause(value?: boolean): void; cancel(id: string): boolean; cancelRequest(): void;
  snapshot(): QueueSnapshot & { active: boolean; busy: boolean; eventCount: number };
  diagnostics(): Diagnostic[]; clearDiagnostics(): void;
}
export function createAssistantRuntime(options: { provider: Provider; now?: () => number; timeoutMs?: number; eventLimit?: number; queueLimit?: number; traceLimit?: number; maxEventAgeMs?: number; dedupeLimit?: number }): Runtime;
export function createSuggestionQueue(options?: { now?: () => number; limit?: number; historyLimit?: number; onTransition?: (code: string, id?: string) => void }): {
  offer(value: Suggestion): boolean; present(): Suggestion | null; decide(id: string, value: Feedback): boolean;
  cancel(id: string): boolean; clear(): void; pause(value?: boolean): void; snapshot(): QueueSnapshot;
};
export function createProviderRunner<T, R>(options: { provider: (context: T, options: { signal: AbortSignal }) => R | Promise<R>; timeoutMs?: number; now?: () => number; onTransition?: (code: string) => void }): {
  run(context: T): Promise<{ status: 'completed'; value: R; durationMs: number } | { status: 'cancelled' | 'timeout' | 'failed' | 'invalid'; durationMs?: number }>;
  cancel(): void; dispose(): void; readonly busy: boolean;
};
export function createJournal(options?: { now?: () => number; limit?: number }): { add(stage: string, code: string, id?: string): void; snapshot(): Diagnostic[]; clear(): void };
export function createTextRenderer(rows: { id: string; text: string }[]): { text(id: string, values?: Record<string, string | number | boolean>): string };
export function slots(template: string): string[];
export function createLiveConnectAdapter(options: { scope: string; rooms: { platform: string; roomId: string }[]; allowSimulation?: boolean; project?: (row: Record<string, unknown>) => JsonValue }): { adapt(row: unknown): AssistantEvent | null };
export interface DisplayItem { id: string; expiresAt?: number; createdAt?: number; [key: string]: unknown }
export type Displayed<T> = T & { sourceExpiresAt?: number; displayUntil: number; displayedAt: number | null; minimumDisplayUntil: number; reading: { active: boolean; manual: boolean; until: number | null; available: boolean } };
export function createDisplayLease<T extends DisplayItem>(options: { now?: () => number; readingDuration: (item: T) => number; urgency: (item: T | undefined) => number; maxHoldMs: number; maxCards?: number; budgetLimit?: number }): {
  select(candidates?: T[], options?: { scope?: string; present?: boolean; valid?: (item: T) => boolean }): (T | Displayed<T>)[];
  acknowledge(id: string): boolean; lookup(id: string): Displayed<T> | null; release(id: string): boolean; clear(): void;
  interact(input: { id: string; reason: 'pointer' | 'focus' | 'manual'; active: boolean }): boolean;
  replace(id: string, item: T): boolean;
};
