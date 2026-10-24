'use strict';
// All examples are mechanical, synthetic fixtures. No operational advice.
const { createAssistantRuntime, createLiveConnectAdapter } = require('../core/index.cjs');
function createSimulation() {
  let at = 1000, sequence = 0, mode = 'observe';
  const runtime = createAssistantRuntime({ now: () => at, provider: context => {
    if (mode === 'remember') return { mode, memory: { count: context.events.length } };
    if (mode === 'observe') return { mode };
    return { mode: 'suggest', suggestions: [{ id: `fixture-card-${++sequence}`, title: 'Synthetic card',
      message: 'This card verifies delivery only.', evidence: `Synthetic event count: ${context.events.length}`,
      createdAt: at, expiresAt: at + 1000, priority: 0 }] };
  } });
  let session = 0, adapter;
  function start() { const scope = `fixture-session-${++session}`; runtime.start(scope);
    adapter = createLiveConnectAdapter({ scope, rooms: [{ platform: 'bilibili', roomId: 'fixture-room' }], allowSimulation: true }); }
  start();
  function ingest() { const value = adapter.adapt({ schemaVersion: 1, event_id: `preview:bilibili:fixture-${++sequence}`,
    event_type: 'comment', platform: 'bilibili', room_id: 'fixture-room', received_at: at, preview: true, source: 'simulation' }); return runtime.ingest(value); }
  async function action(name) {
    if (name === 'event') ingest();
    else if (['observe', 'remember', 'suggest'].includes(name)) { mode = name; await runtime.evaluate(); }
    else if (name === 'pause') runtime.pause(true);
    else if (name === 'resume') runtime.pause(false);
    else if (name === 'expire') at += 1001;
    else if (name === 'reset') start();
    else if (['adopted', 'rejected', 'dismissed'].includes(name)) { const current = runtime.snapshot().current; if (current) runtime.decide(current.id, name); }
    else throw new Error('Unknown simulation action');
    runtime.present(); return snapshot();
  }
  function snapshot() { return { synthetic: true, time: at, ...runtime.snapshot(), trace: runtime.diagnostics() }; }
  return { action, snapshot, dispose: runtime.dispose };
}
async function replay() {
  const simulation = createSimulation(), transitions = [];
  try { for (const action of ['event', 'observe', 'remember', 'pause', 'suggest', 'resume', 'adopted', 'suggest', 'expire', 'reset']) {
    const state = await simulation.action(action);
    transitions.push({ action, pending: state.pending.length, displayed: state.current?.id || null, terminal: state.history.map(row => row.state) });
  } return { synthetic: true, transitions, diagnostics: simulation.snapshot().trace }; } finally { simulation.dispose(); }
}
async function replayRealtime() {
  const { createRealtimeState, createAnalysisBudget, createAnalysisScheduler } = require('../core/index.cjs');
  let at = 100, finish, calls = 0;
  const state = createRealtimeState({ now: () => at }); state.start('synthetic-session');
  const update = value => state.patch([{ key: 'fixture', source: 'synthetic', status: 'known', value, observedAt: at, ttlMs: 100 }]);
  update(1); const original = state.capture(['fixture']);
  // Tiny fixture numbers exercise accounting; they are not production limits.
  const budget = createAnalysisBudget({ capacity: 2, windowMs: 1000, minIntervalMs: 0, now: () => at });
  const scheduler = createAnalysisScheduler({ state, budget, now: () => at,
    provider: () => { calls++; return calls === 1 ? new Promise(resolve => { finish = resolve; }) : { mode: 'observe' }; } });
  try {
    const pending = scheduler.request({ key: 'fixture-version-one', context: { synthetic: true }, dependencies: ['fixture'] });
    at = 110; update(1); const timestampRefreshPreserved = state.isCurrent(original);
    at = 120; update(2); const obsolete = await pending; finish({ mode: 'observe' });
    const second = await scheduler.request({ key: 'fixture-version-two', context: { synthetic: true }, dependencies: ['fixture'] });
    const duplicate = await scheduler.request({ key: 'fixture-version-two', context: { synthetic: true } });
    update(3); const exhausted = await scheduler.request({ key: 'fixture-version-three', context: { synthetic: true } });
    return { synthetic: true, timestampRefreshPreserved, obsolete: obsolete.status, current: second.status,
      duplicate: duplicate.status, exhausted: exhausted.status, calls, budget: budget.snapshot(), checkpoint: budget.checkpoint() };
  } finally { scheduler.dispose(); state.stop(); }
}
module.exports = { createSimulation, replay, replayRealtime };
