'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRealtimeState, createAnalysisBudget, createAnalysisScheduler } = require('../core/index.cjs');
const fact = (key, value, observedAt = 100, extra = {}) => ({ key, source: 'fixture', status: 'known', value, observedAt, ttlMs: 100, ...extra });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; };
function environment(extra = {}) {
  let at = 100;
  const state = createRealtimeState({ now: () => at }); state.start('fixture-session'); state.patch([fact('context', 1)]);
  const budget = createAnalysisBudget({ capacity: 3, windowMs: 100, minIntervalMs: 0, now: () => at, ...extra });
  return { state, budget, now: () => at, advance: value => { at = value; } };
}

test('facts distinguish known false and zero from unavailable data and return immutable snapshots', () => {
  const state = createRealtimeState({ now: () => 100 }); assert.throws(() => state.patch([]), /STATE_UNAVAILABLE/);
  state.start('fixture'); state.patch([fact('zero', 0), fact('false', false), fact('missing', null, 100, { status: 'unknown', reason: 'unavailable' })]);
  const snapshot = state.snapshot(); assert.equal(snapshot.facts.zero.status, 'fresh'); assert.equal(snapshot.facts.zero.value, 0);
  assert.equal(snapshot.facts.false.value, false); assert.equal(snapshot.facts.missing.status, 'unknown'); assert.equal(snapshot.facts.missing.value, null);
  assert.ok(Object.isFrozen(snapshot.facts.zero)); assert.throws(() => { snapshot.facts.zero.value = 99; });
});

test('timestamp refresh does not invalidate context, but source changes and elapsed freshness do', () => {
  const env = environment(), token = env.state.capture(); const revision = env.state.snapshot().revision;
  env.advance(150); assert.equal(env.state.patch([fact('context', 1, 150)]), false); assert.equal(env.state.snapshot().revision, revision);
  assert.equal(env.state.isCurrent(token), true); env.advance(250); assert.equal(env.state.isCurrent(token), false);
  assert.equal(env.state.snapshot().facts.context.status, 'stale'); const stale = env.state.capture();
  env.state.patch([fact('context', 1, 250)]); assert.equal(env.state.isCurrent(stale), false); assert.equal(env.state.isCurrent(token), false);
  const refreshed = env.state.capture(); env.state.patch([fact('context', 1, 250, { source: 'another-fixture' })]); assert.equal(env.state.isCurrent(refreshed), false);
});

test('refresh after unseen expiry still invalidates an old token instead of resurrecting it', () => {
  const env = environment(), token = env.state.capture(); env.advance(250);
  env.state.patch([fact('context', 1, 250)]); assert.equal(env.state.isCurrent(token), false); assert.equal(env.state.snapshot().facts.context.status, 'fresh');
});

test('dependency tokens ignore unrelated changes and detect missing keys becoming known', () => {
  const env = environment(), context = env.state.capture(['context']), missing = env.state.capture(['later']), all = env.state.capture();
  env.state.patch([fact('other', 1)]); assert.equal(env.state.isCurrent(context), true); assert.equal(env.state.isCurrent(all), false);
  env.state.patch([fact('later', 0)]); assert.equal(env.state.isCurrent(missing), false);
  const original = env.state.capture(['context']); env.state.start('fixture-session'); env.state.patch([fact('context', 1)]);
  assert.equal(env.state.isCurrent(original), false); env.state.stop(); assert.equal(env.state.snapshot().active, false); assert.throws(() => env.state.capture());
});

test('fact patches fail atomically on duplicates, old observations, overflow or oversized data', () => {
  const env = environment(), before = env.state.snapshot();
  for (const rows of [[fact('context', 2), fact('late', 1, 101)], [fact('context', 2), fact('context', 3)], [fact('context', 2, 99)],
    [fact('extra', 'a'.repeat(65537))], [fact('__proto__', 1)], [fact('unknown', 1, 100, { status: 'unknown' })]]) {
    assert.throws(() => env.state.patch(rows)); assert.deepEqual(env.state.snapshot(), before);
  }
  const bounded = createRealtimeState({ now: () => 100, limit: 1 }); bounded.start('fixture'); bounded.patch([fact('one', 1)]);
  assert.throws(() => bounded.patch([fact('two', 2)]), /FACT_CAPACITY/); assert.equal(Object.keys(bounded.snapshot().facts).length, 1);
});

test('state observers see complete semantic transitions and cannot interrupt state updates', () => {
  const env = environment(); let updates = 0; const values = [];
  const release = env.state.subscribe(() => { updates++; values.push(env.state.snapshot()); });
  env.state.subscribe(() => { throw new Error('synthetic observer'); });
  env.state.patch([fact('context', 2), fact('another', 3)]); assert.equal(updates, 1); assert.equal(values[0].facts.another.value, 3);
  env.advance(110); env.state.patch([fact('context', 2, 110)]); assert.equal(updates, 1); release(); env.state.stop(); assert.equal(updates, 1);
});

test('malformed tokens fail closed and value-key order does not create a semantic change', () => {
  const env = environment(); env.state.patch([fact('object', { a: 1, b: 2 })]); const token = env.state.capture(['object']);
  env.state.patch([fact('object', { b: 2, a: 1 })]); assert.equal(env.state.isCurrent(token), true);
  for (const broken of [null, {}, { ...token, all: undefined }, { ...token, revision: NaN },
    { ...token, versions: [...token.versions, ...token.versions] }, { ...token, versions: [{ key: 'object', revision: -1 }] }]) {
    assert.equal(env.state.isCurrent(broken), false);
  }
});

test('budget requires explicit limits and rejects corrupt, duplicate or future checkpoints', () => {
  assert.throws(() => createAnalysisBudget());
  const options = { capacity: 3, windowMs: 100, minIntervalMs: 10, now: () => 100 };
  for (const state of [{}, { schemaVersion: 1, reservations: [{ key: 'a', at: 101, cost: 1 }] },
    { schemaVersion: 1, reservations: [{ key: 'a', at: 90, cost: 0 }] },
    { schemaVersion: 1, reservations: [{ key: 'a', at: 90, cost: 1 }, { key: 'a', at: 91, cost: 1 }] }]) {
    assert.throws(() => createAnalysisBudget({ ...options, initialState: state }));
  }
});

test('rolling budget reserves weighted cost once and calculates the next admissible time', () => {
  const env = environment({ minIntervalMs: 10 });
  assert.equal(env.budget.tryAcquire('a', 2).allowed, true); assert.equal(env.budget.tryAcquire('a').reason, 'duplicate');
  env.advance(105); assert.deepEqual(env.budget.tryAcquire('b'), { allowed: false, reason: 'interval', retryAt: 110 });
  env.advance(110); assert.deepEqual(env.budget.tryAcquire('b', 2), { allowed: false, reason: 'budget', retryAt: 200 });
  assert.equal(env.budget.tryAcquire('b').allowed, true); assert.equal(env.budget.snapshot().used, 3); assert.equal(env.budget.snapshot().nextAvailableAt, 200);
  env.advance(200); assert.equal(env.budget.snapshot().used, 1); assert.equal(env.budget.tryAcquire('c', 2).allowed, true);
  assert.equal(env.budget.tryAcquire('oversized', 4).reason, 'capacity');
});

test('restored reservations preserve cost and intervals without a reset or refund path', () => {
  const env = environment({ windowMs: 10, minIntervalMs: 100 }); env.budget.tryAcquire('a', 2); env.advance(120);
  assert.equal(env.budget.snapshot().used, 0); assert.equal(env.budget.checkpoint().reservations.length, 1);
  const restored = createAnalysisBudget({ capacity: 1, windowMs: 10, minIntervalMs: 100, now: env.now, initialState: env.budget.checkpoint() });
  assert.deepEqual(restored.tryAcquire('b'), { allowed: false, reason: 'interval', retryAt: 200 });
  env.advance(200); assert.equal(restored.tryAcquire('b').allowed, true); assert.equal(restored.snapshot().used, 1);
  assert.ok(Object.isFrozen(restored.checkpoint().reservations[0]));
});

test('lowering a restored budget cannot erase committed cost; clock rollback and excessive storage fail closed', () => {
  const env = environment(); env.budget.tryAcquire('a', 3);
  const restored = createAnalysisBudget({ capacity: 1, windowMs: 100, minIntervalMs: 0, now: env.now, initialState: env.budget.checkpoint() });
  assert.equal(restored.snapshot().used, 3); assert.equal(restored.snapshot().remaining, 0); assert.equal(restored.tryAcquire('b').reason, 'budget');
  env.advance(99); assert.throws(() => restored.tryAcquire('c'), /BUDGET_CLOCK_REVERSED/);
  const limited = createAnalysisBudget({ capacity: 3, windowMs: 100, minIntervalMs: 0, now: () => 100, reservationLimit: 1 });
  assert.equal(limited.tryAcquire('a').allowed, true); assert.equal(limited.tryAcquire('b').reason, 'capacity');
});

test('scheduler coalesces an active request and charges once without implicit inference', async () => {
  const env = environment(), pending = deferred(); let calls = 0;
  const scheduler = createAnalysisScheduler({ ...env, provider: () => { calls++; return pending.promise; } });
  env.state.patch([fact('another', 1)]); assert.equal(calls, 0);
  const first = scheduler.request({ key: 'version-a', context: { value: 1 }, dependencies: ['context'] });
  assert.equal(scheduler.request({ key: 'version-a', context: { value: 1 }, dependencies: ['context'] }), first);
  assert.equal((await scheduler.request({ key: 'version-b', context: {} })).status, 'busy');
  assert.equal(env.budget.snapshot().used, 1); pending.resolve({ output: 'synthetic' }); assert.equal((await first).status, 'completed');
  assert.equal(calls, 1); assert.equal((await scheduler.request({ key: 'version-a', context: {} })).status, 'duplicate'); scheduler.dispose();
});

test('semantic invalidation aborts pending inference and rejects a late result without refunding cost', async () => {
  const env = environment(), pending = deferred(); let signal;
  const scheduler = createAnalysisScheduler({ ...env, provider: (_, options) => { signal = options.signal; return pending.promise; } });
  const task = scheduler.request({ key: 'a', context: {}, dependencies: ['context'] });
  env.state.patch([fact('context', 2)]); assert.equal(signal.aborted, true); assert.equal((await task).status, 'stale');
  pending.resolve({ output: 'late' }); await new Promise(resolve => setImmediate(resolve)); assert.equal(env.budget.snapshot().used, 1);
  assert.equal((await scheduler.request({ key: 'a', context: {} })).status, 'duplicate'); scheduler.dispose();
});

test('unrelated state refreshes do not abort selected dependencies, but expiry fences completion', async () => {
  const env = environment(), pending = deferred(); let signal;
  const scheduler = createAnalysisScheduler({ ...env, provider: (_, options) => { signal = options.signal; return pending.promise; } });
  const task = scheduler.request({ key: 'a', context: {}, dependencies: ['context'] });
  env.state.patch([fact('metrics', 1)]); env.advance(150); env.state.patch([fact('metrics', 2, 150)]); assert.equal(signal.aborted, false);
  env.advance(200); pending.resolve({ output: 'expired' }); assert.equal((await task).status, 'stale'); scheduler.dispose();
});

test('scheduler cancellation, timeout and failure consume started attempts and do not retry automatically', async () => {
  const env = environment(); let calls = 0;
  const scheduler = createAnalysisScheduler({ ...env, timeoutMs: 10, provider: () => { calls++; if (calls === 3) throw new Error('synthetic-private-error'); return new Promise(() => {}); } });
  const first = scheduler.request({ key: 'a', context: {} }); scheduler.pause(); assert.equal((await first).status, 'cancelled');
  assert.equal((await scheduler.request({ key: 'b', context: {} })).status, 'paused'); scheduler.pause(false);
  assert.equal((await scheduler.request({ key: 'b', context: {} })).status, 'timeout');
  assert.equal((await scheduler.request({ key: 'c', context: {} })).status, 'failed');
  assert.equal((await scheduler.request({ key: 'd', context: {} })).status, 'budget'); assert.equal(calls, 3); assert.equal(env.budget.snapshot().used, 3);
  env.advance(201); assert.equal((await scheduler.request({ key: 'c', context: {} })).status, 'duplicate'); assert.equal(calls, 3); scheduler.dispose();
});

test('invalid contexts are refused before reservations and disposal prevents further requests', async () => {
  const env = environment(); let calls = 0; const scheduler = createAnalysisScheduler({ ...env, provider: () => { calls++; } });
  assert.equal((await scheduler.request({ key: 'a', context: { fn: () => {} } })).status, 'invalid'); assert.equal(env.budget.snapshot().used, 0);
  env.state.stop(); assert.equal((await scheduler.request({ key: 'b', context: {} })).status, 'invalid'); assert.equal(calls, 0);
  scheduler.dispose(); assert.equal((await scheduler.request({ key: 'c', context: {} })).status, 'cancelled');
});

for (const action of ['cancel', 'pause', 'dispose']) {
  test(`scheduler ${action} fences a settled provider before the public promise is delivered`, async () => {
    const env = environment();
    const scheduler = createAnalysisScheduler({ ...env, provider: () => 'fixture-result' });
    const task = scheduler.request({ key: 'settled-fixture', context: {} });
    let providerReleased;
    const cancelled = new Promise(resolve => queueMicrotask(() => {
      providerReleased = !scheduler.snapshot().busy; scheduler[action](); resolve();
    }));
    const [result] = await Promise.all([task, cancelled]);
    assert.equal(providerReleased, true, 'cancellation occurs after the provider runner released its slot');
    assert.deepEqual(result, { status: 'cancelled' }); assert.equal(env.budget.snapshot().used, 1);
    scheduler.dispose();
  });
}

test('a cancelled completion cannot clear or complete a replacement request', async () => {
  const env = environment(), pending = deferred(); let calls = 0, second;
  const scheduler = createAnalysisScheduler({ ...env, provider: () => ++calls === 1 ? 'first-fixture' : pending.promise });
  const first = scheduler.request({ key: 'first', context: {} });
  const replaced = new Promise(resolve => queueMicrotask(() => {
    scheduler.cancel(); second = scheduler.request({ key: 'second', context: {} }); resolve();
  }));
  assert.deepEqual(await first, { status: 'cancelled' }); await replaced;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scheduler.snapshot().busy, true); assert.equal(scheduler.request({ key: 'second', context: {} }), second);
  assert.equal(env.budget.snapshot().used, 2); pending.resolve('second-fixture');
  const result = await second; assert.equal(result.status, 'completed'); assert.equal(result.value, 'second-fixture'); scheduler.dispose();
});
