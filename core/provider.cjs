'use strict';
const { freeze, json, number } = require('./contracts.cjs');
function createProviderRunner({ provider, timeoutMs = 30000, now = Date.now, onTransition = () => {} } = {}) {
  if (typeof provider !== 'function') throw new TypeError('An explicit provider is required');
  number(timeoutMs, 1);
  if (timeoutMs > 2147483647) throw new RangeError('Timeout exceeds the timer range');
  let active = null, revision = 0, stopped = false;
  function emit(code) { try { onTransition(code); } catch { /* Isolated diagnostics. */ } }
  function cancel() { if (active) active.end({ status: 'cancelled' }); }
  function run(context) {
    if (stopped) return Promise.resolve({ status: 'cancelled' });
    if (active) return active.promise;
    // Snapshot before invoking external code. Never persist or log this payload.
    let snapshot;
    try { snapshot = freeze(json(context)); } catch { return Promise.resolve({ status: 'invalid' }); }
    const token = ++revision, controller = new AbortController();
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const job = { token, promise, end: null }, startedAt = now();
    let timer;
    job.end = result => {
      if (active !== job) return;
      clearTimeout(timer); active = null;
      if (result.status !== 'completed') controller.abort();
      if (result.status !== 'completed') emit(result.status);
      resolve({ ...result, durationMs: Math.max(0, now() - startedAt) });
    };
    active = job;
    timer = setTimeout(() => job.end({ status: 'timeout' }), timeoutMs);
    emit('requested');
    let response;
    try {
      if (active !== job || controller.signal.aborted) return promise;
      response = provider(snapshot, { signal: controller.signal });
    } catch { job.end({ status: 'failed' }); return promise; }
    Promise.resolve(response).then(value => {
      if (active === job && !controller.signal.aborted) job.end({ status: 'completed', value });
    }, () => job.end({ status: 'failed' }));
    return promise;
  }
  return { run, cancel, dispose: () => { stopped = true; cancel(); }, get busy() { return Boolean(active); } };
}
module.exports = { createProviderRunner };
