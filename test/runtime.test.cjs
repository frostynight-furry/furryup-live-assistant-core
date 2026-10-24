'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAssistantRuntime, createProviderRunner, createSuggestionQueue, createLiveConnectAdapter, createTextRenderer, createDisplayLease } = require('../core/index.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const row = (id, at = 100, extra = {}) => ({ id, scope: 'session-a', type: 'sample', at, data: {}, ...extra });
const card = (id, extra = {}) => ({ id, title: 'Fixture card', message: 'Synthetic output', createdAt: 100, expiresAt: 1000, ...extra });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('runtime requires an explicit provider; ingestion alone never requests inference', async () => {
  assert.throws(() => createAssistantRuntime(), /provider/);
  let calls = 0;
  const app = createAssistantRuntime({ now: () => 100, provider: () => { calls++; return { mode: 'observe' }; } });
  assert.equal(app.ingest(row('a')), false); assert.deepEqual(await app.evaluate(), { status: 'unavailable' });
  app.start('session-a'); app.ingest(row('a')); await tick(); assert.equal(calls, 0);
  assert.equal((await app.evaluate()).mode, 'observe'); assert.equal(calls, 1); assert.equal(app.present(), null); app.dispose();
});
test('ingestion deduplicates, validates room/time and bounds context and dedupe storage', async () => {
  let at = 100, captured;
  const app = createAssistantRuntime({ now: () => at, eventLimit: 1, dedupeLimit: 2, maxEventAgeMs: 50, provider: context => { captured = context; return { mode: 'observe' }; } });
  app.start('session-a');
  assert.equal(app.ingest(row('a')), true); assert.equal(app.ingest(row('a')), false);
  assert.equal(app.ingest(row('b', 90)), true); assert.equal(app.ingest(row('c')), false);
  assert.equal(app.ingest(row('d', 101)), false); assert.equal(app.ingest(row('e', 40)), false);
  assert.equal(app.ingest(row('f', 100, { scope: 'session-b' })), false);
  assert.equal(app.ingest(row('g', 100, { data: { nested: undefined } })), false);
  await app.evaluate(); assert.deepEqual(captured.events.map(x => x.id), ['b']);
  at = 151; assert.equal(app.ingest(row('a', at)), true); await app.evaluate();
  assert.deepEqual(captured.events.map(x => x.at), [151]); app.dispose();
});
test('context is detached, frozen and memory is session scoped', async () => {
  const contexts = [];
  const app = createAssistantRuntime({ now: () => 100, provider: context => { contexts.push(context); return { mode: 'remember', memory: { value: contexts.length } }; } });
  app.start('session-a'); const input = row('a', 100, { data: { value: 'original' } }); app.ingest(input); input.data.value = 'mutated';
  await app.evaluate(); assert.equal(contexts[0].events[0].data.value, 'original'); assert.ok(Object.isFrozen(contexts[0].events[0].data));
  await app.evaluate(); assert.deepEqual(contexts[1].memory, { value: 1 }); assert.equal(app.present(), null);
  app.start('session-b'); await app.evaluate(); assert.equal(contexts[2].memory, null); assert.deepEqual(contexts[2].events, []); app.dispose();
});
test('duplicate evaluate calls coalesce and do not enqueue twice', async () => {
  const pending = deferred(); let calls = 0;
  const app = createAssistantRuntime({ now: () => 100, provider: () => { calls++; return pending.promise; } });
  app.start('session-a'); const first = app.evaluate(), second = app.evaluate(); assert.equal(first, second);
  await tick(); pending.resolve({ mode: 'suggest', suggestions: [card('a')] }); await first;
  assert.equal(calls, 1); assert.equal(app.snapshot().pending.length, 1);
  assert.equal(app.present().id, 'a'); assert.equal(app.decide('a', 'adopted'), true); assert.equal(app.decide('a', 'adopted'), false);
  app.dispose();
});
test('switching scope aborts a pending provider and fences a late result even if it ignores cancellation', async () => {
  const pending = deferred(); let signal;
  const app = createAssistantRuntime({ now: () => 100, provider: (_, options) => { signal = options.signal; return pending.promise; } });
  app.start('session-a'); const first = app.evaluate(); await tick(); app.start('session-b');
  assert.equal(signal.aborted, true); assert.equal((await first).status, 'cancelled');
  pending.resolve({ mode: 'suggest', suggestions: [card('late')] }); await tick(); assert.equal(app.present(), null); app.dispose();
});
test('cancelled task cannot clear the next active task', async () => {
  const first = deferred(), second = deferred(); let calls = 0;
  const app = createAssistantRuntime({ now: () => 100, provider: () => (++calls === 1 ? first.promise : second.promise) });
  app.start('session-a'); const a = app.evaluate(); await tick(); app.cancelRequest();
  const b = app.evaluate(); await tick(); await a; first.resolve({ mode: 'observe' }); await tick();
  assert.equal(app.snapshot().busy, true); assert.equal(app.evaluate(), b);
  second.resolve({ mode: 'observe' }); assert.equal((await b).status, 'completed'); app.dispose();
});
test('timeout releases hung providers; errors never expose provider messages', async () => {
  let calls = 0;
  const app = createAssistantRuntime({ timeoutMs: 15, provider: () => { if (++calls === 1) return new Promise(() => {}); throw new Error('synthetic-secret-response'); } });
  app.start('session-a'); assert.equal((await app.evaluate()).status, 'timeout');
  assert.equal((await app.evaluate()).status, 'failed'); assert.equal(app.snapshot().busy, false);
  assert.ok(!JSON.stringify(app.diagnostics()).includes('synthetic-secret-response')); app.dispose();
});
test('invalid batches are atomic; executable or oversized provider output is refused', async () => {
  const outputs = [ { mode: 'suggest', suggestions: [card('ok'), card('bad', { expiresAt: 50 })] },
    { mode: 'remember', memory: { action: () => 1 } }, { mode: 'suggest', suggestions: [card('large', { message: 'a'.repeat(4001) })] } ];
  const app = createAssistantRuntime({ now: () => 100, provider: () => outputs.shift() });
  app.start('session-a'); for (let i = 0; i < 3; i++) { assert.equal((await app.evaluate()).status, 'invalid'); assert.equal(app.present(), null); } app.dispose();
});
test('observe and memory output never imply a visible card or any external action', async () => {
  const app = createAssistantRuntime({ provider: () => ({ mode: 'observe', action: 'arbitrary' }) });
  app.start('session-a'); await app.evaluate(); assert.equal(app.present(), null); app.dispose();
});
test('provider runner rejects invalid input without calling external code', async () => {
  let calls = 0; const runner = createProviderRunner({ provider: () => { calls++; } });
  assert.equal((await runner.run({ value: Infinity })).status, 'invalid'); assert.equal(calls, 0); runner.dispose();
  assert.equal((await runner.run({})).status, 'cancelled');
});

test('synchronous provider reentry shares the same evaluation and session reset releases it', async () => {
  let nested, calls = 0;
  const app = createAssistantRuntime({ provider: () => { calls++; nested = app.evaluate(); return { mode: 'observe' }; } });
  app.start('session-a'); const first = app.evaluate(); assert.equal(nested, first);
  assert.equal((await first).status, 'completed'); assert.equal(calls, 1); app.dispose();
  let resets = 0;
  const other = createAssistantRuntime({ provider: () => { if (!resets++) other.start('session-b'); return { mode: 'observe' }; } });
  other.start('session-a'); assert.equal((await other.evaluate()).status, 'cancelled');
  assert.equal((await other.evaluate()).status, 'completed'); other.dispose();
});

test('transition cancellation prevents provider invocation and invalid timer ranges fail explicitly', async () => {
  assert.throws(() => createProviderRunner({ provider: () => {}, timeoutMs: 2147483648 }), /timer range/);
  let calls = 0;
  const runner = createProviderRunner({ provider: () => { calls++; }, onTransition: code => { if (code === 'requested') runner.cancel(); } });
  assert.equal((await runner.run({})).status, 'cancelled'); assert.equal(calls, 0); runner.dispose();
});
test('queue orders priorities stably; pause suppresses pending ordinary cards, never loses them', () => {
  const q = createSuggestionQueue({ now: () => 100 });
  q.offer(card('a')); q.offer(card('b', { priority: 1 })); q.offer(card('c', { urgent: true, priority: 2 }));
  q.pause(); assert.equal(q.present().id, 'c'); q.decide('c', 'dismissed'); assert.equal(q.present(), null);
  q.pause(false); assert.equal(q.present().id, 'b'); q.decide('b', 'adopted'); assert.equal(q.present().id, 'a');
  assert.throws(() => q.decide('a', 'unknown')); assert.equal(q.decide('missing', 'rejected'), false);
});
test('queue does not replace a visible payload, and expires it before accepting feedback', () => {
  let at = 100; const q = createSuggestionQueue({ now: () => at });
  q.offer(card('a')); assert.equal(q.present().id, 'a'); q.offer(card('b', { priority: 99 }));
  assert.equal(q.present().id, 'a'); assert.equal(q.offer(card('a', { message: 'different' })), false);
  at = 1000; assert.equal(q.decide('a', 'adopted'), false); assert.equal(q.present(), null);
  assert.equal(q.snapshot().history.filter(x => x.state === 'expired').length, 2);
});
test('queue cooldown, capacity, cancel and session reset are explicit', () => {
  let at = 100; const q = createSuggestionQueue({ now: () => at, limit: 1 });
  assert.equal(q.offer(card('a', { cooldownKey: 'group', cooldownMs: 100 })), true);
  assert.equal(q.offer(card('b')), false); assert.equal(q.cancel('a'), true);
  assert.equal(q.offer(card('c', { cooldownKey: 'group' })), false);
  at = 200; assert.equal(q.offer(card('c', { cooldownKey: 'group' })), true); q.clear(); assert.equal(q.offer(card('a')), true);
});
test('diagnostics use bounded state metadata without message text or original identifiers', async () => {
  const app = createAssistantRuntime({ now: () => 100, traceLimit: 3, provider: () => ({ mode: 'suggest', suggestions: [card('secret-item')] }) });
  app.start('session-a'); app.ingest(row('private-event-id', 100, { data: { text: 'private-fixture-text' } }));
  await app.evaluate(); app.present(); app.decide('secret-item', 'adopted');
  const rows = app.diagnostics(); assert.equal(rows.length, 3); assert.ok(rows.some(x => x.stage === 'feedback'));
  assert.ok(!/private-event-id|private-fixture-text|secret-item|Synthetic output/.test(JSON.stringify(rows)));
  rows[0].code = 'changed'; assert.notEqual(app.diagnostics()[0].code, 'changed'); app.dispose();
});
test('LiveConnect mapping rejects previews/foreign rooms and excludes raw payload by default', () => {
  const adapter = createLiveConnectAdapter({ scope: 'session-a', rooms: [{ platform: 'bilibili', roomId: 'fixture-room' }] });
  const source = { schemaVersion: 1, event_id: 'live:bilibili:fixture', event_type: 'comment', platform: 'bilibili', room_id: 'fixture-room', received_at: 100, preview: false, source: 'ordinaryroad', content: 'fixture-private-text', cookie: 'fixture-secret' };
  const output = adapter.adapt(source); assert.deepEqual(output.data, {}); assert.equal(output.type, 'comment');
  assert.equal(adapter.adapt({ ...source, preview: true }), null); assert.equal(adapter.adapt({ ...source, source: 'simulation' }), null);
  assert.equal(adapter.adapt({ ...source, room_id: 'different' }), null); assert.equal(adapter.adapt({ ...source, schemaVersion: 2 }), null);
  assert.equal(adapter.adapt({ ...source, received_at: NaN }), null);
  assert.equal(adapter.adapt({ ...source, preview: 'false' }), null);
});
test('LiveConnect projection and synthetic permission must be explicit', () => {
  const adapter = createLiveConnectAdapter({ scope: 'session-a', rooms: [{ platform: 'douyin', roomId: 'fixture' }], allowSimulation: true, project: row => ({ count: row.count }) });
  assert.deepEqual(adapter.adapt({ schemaVersion: 1, event_id: 'preview:douyin:1', event_type: 'sample', platform: 'douyin', room_id: 'fixture', received_at: 100, preview: true, source: 'simulation', count: 2 }).data, { count: 2 });
});
test('templates have no fallback, do literal substitution once and reject duplicate IDs', () => {
  assert.throws(() => createTextRenderer()); assert.throws(() => createTextRenderer([{ id: 'a', text: '' }, { id: 'a', text: '' }]));
  const render = createTextRenderer([{ id: 'a', text: 'Value [[value]]' }]);
  assert.equal(render.text('a', { value: '[[other]]' }), 'Value [[other]]');
  assert.throws(() => render.text('a', {})); assert.throws(() => render.text('a', { value: Infinity })); assert.throws(() => render.text('missing'));
});
test('display timing and urgency are injected; scope invalidation beats an active reading lease', () => {
  assert.throws(() => createDisplayLease());
  let at = 100; const gate = createDisplayLease({ now: () => at, readingDuration: () => 20, urgency: row => row.priority || 0, maxHoldMs: 50 });
  gate.select([card('a')], { scope: 'session-a', present: true }); gate.acknowledge('a');
  gate.interact({ id: 'a', reason: 'manual', active: true }); at = 125;
  assert.equal(gate.select([card('b')], { scope: 'session-a', present: true })[0].id, 'a');
  gate.select([], { scope: 'session-b' }); assert.equal(gate.lookup('a'), null);
});
