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
module.exports = { createSimulation, replay };
