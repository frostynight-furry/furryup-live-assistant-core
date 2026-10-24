'use strict';
const contract = require('./contracts.cjs');
const { createJournal } = require('./journal.cjs');
const { createSuggestionQueue } = require('./queue.cjs');
const { createProviderRunner } = require('./provider.cjs');
function createAssistantRuntime({ provider, now = Date.now, timeoutMs = 30000, eventLimit = 200, queueLimit = 64,
  traceLimit = 1000, maxEventAgeMs = 300000, dedupeLimit = 4096 } = {}) {
  for (const n of [eventLimit, queueLimit, traceLimit, maxEventAgeMs, dedupeLimit]) contract.number(n, 1);
  const journal = createJournal({ now, limit: traceLimit });
  const queue = createSuggestionQueue({ now, limit: queueLimit, onTransition: (code, id) => journal.add('queue', code, id) });
  const runner = createProviderRunner({ provider, now, timeoutMs, onTransition: code => journal.add('provider', code) });
  let scope = null, revision = 0, events = [], memory = null, disposed = false, evaluating = null;
  const seen = new Map();
  function start(value) {
    if (disposed) throw new Error('RUNTIME_DISPOSED');
    contract.text(value, 512); stop(); scope = value; journal.add('session', 'started');
  }
  function stop() {
    revision++; runner.cancel(); evaluating = null; queue.clear(); events = []; seen.clear(); memory = null;
    if (scope !== null) journal.add('session', 'stopped'); scope = null;
  }
  function ingest(input) {
    if (disposed || !scope) return false;
    let row; try { row = contract.event(input); } catch { journal.add('event', 'invalid'); return false; }
    if (row.scope !== scope) { journal.add('event', 'foreign', row.id); return false; }
    if (row.at > now() || now() - row.at > maxEventAgeMs) { journal.add('event', 'stale', row.id); return false; }
    for (const [id, expiresAt] of seen) if (expiresAt < now()) seen.delete(id);
    if (seen.has(row.id)) { journal.add('event', 'duplicate', row.id); return false; }
    // Refuse overflow rather than evict live deduplication keys and replay actions.
    if (seen.size >= dedupeLimit) { journal.add('event', 'full'); return false; }
    seen.set(row.id, row.at + maxEventAgeMs); events.push(row);
    if (events.length > eventLimit) events.shift(); journal.add('event', 'accepted', row.id); return true;
  }
  function evaluate() {
    if (disposed || !scope) return Promise.resolve({ status: 'unavailable' });
    if (evaluating) return evaluating.promise;
    events = events.filter(row => now() - row.at <= maxEventAgeMs);
    const job = { revision, promise: null };
    let resolve, reject;
    job.promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    evaluating = job;
    runner.run({ scope, at: now(), events, memory }).then(result => {
      if (disposed || job.revision !== revision) return { status: 'cancelled' };
      if (result.status !== 'completed') return { status: result.status };
      let value;
      try { value = contract.decision(result.value, now()); } catch { journal.add('provider', 'invalid'); return { status: 'invalid' }; }
      if (value.mode === 'observe') journal.add('provider', 'observed');
      if (value.mode === 'remember') { memory = value.memory; journal.add('memory', 'remembered'); }
      if (value.mode === 'suggest') for (const row of value.suggestions) queue.offer(row);
      return { status: 'completed', mode: value.mode };
    }).finally(() => { if (evaluating === job) evaluating = null; }).then(resolve, reject);
    return job.promise;
  }
  function decide(id, value) { const accepted = queue.decide(id, value); if (accepted) journal.add('feedback', value, id); return accepted; }
  return { start, stop, ingest, evaluate, present: () => queue.present(), decide, pause: value => queue.pause(value),
    cancel: id => queue.cancel(id), cancelRequest: () => { revision++; runner.cancel(); evaluating = null; },
    snapshot: () => ({ active: scope !== null, busy: runner.busy, eventCount: events.length, ...queue.snapshot() }),
    diagnostics: () => journal.snapshot(), clearDiagnostics: () => journal.clear(),
    dispose: () => { stop(); runner.dispose(); disposed = true; } };
}
module.exports = { createAssistantRuntime };
