'use strict';
const { createProviderRunner } = require('./provider.cjs');
const { text, number, json } = require('./contracts.cjs');
function createAnalysisScheduler({ state, budget, provider, timeoutMs = 30000, now = Date.now, historyLimit = 512 } = {}) {
  if (['capture', 'isCurrent', 'subscribe'].some(key => typeof state?.[key] !== 'function') ||
      ['tryAcquire', 'snapshot'].some(key => typeof budget?.[key] !== 'function')) throw new TypeError('Explicit state and budget are required');
  number(historyLimit, 1);
  const runner = createProviderRunner({ provider, timeoutMs, now }), handled = new Set();
  let active = null, paused = false, disposed = false;
  const unsubscribe = state.subscribe(() => { if (active && !state.isCurrent(active.token)) runner.cancel(); });
  function request({ key, context, dependencies, cost = 1 } = {}) {
    if (disposed) return Promise.resolve({ status: 'cancelled' });
    if (paused) return Promise.resolve({ status: 'paused' });
    text(key, 512); number(cost, 1);
    let token, payload;
    try { token = state.capture(dependencies); payload = json(context); } catch { return Promise.resolve({ status: 'invalid' }); }
    if (active) return active.key === key && state.isCurrent(active.token) ? active.promise : Promise.resolve({ status: 'busy' });
    if (handled.has(key)) return Promise.resolve({ status: 'duplicate' });
    const admission = budget.tryAcquire(key, cost);
    if (!admission.allowed) return Promise.resolve({ status: admission.reason, retryAt: admission.retryAt });
    handled.add(key); while (handled.size > historyLimit) handled.delete(handled.values().next().value);
    let resolve, reject;
    const job = { key, token, cancelled: false, promise: new Promise((done, fail) => { resolve = done; reject = fail; }) };
    active = job;
    const release = () => { if (active === job) active = null; };
    runner.run(payload).then(result => {
      try {
        const current = state.isCurrent(job.token);
        // The runner may have settled before its result reaches this coordinator.
        // Recheck cancellation at the same boundary that settles the public promise.
        const output = job.cancelled || disposed ? { status: 'cancelled' } : !current ? { status: 'stale' } : result;
        release(); resolve(output);
      } catch (error) { release(); reject(error); }
    }, error => { release(); reject(error); });
    return job.promise;
  }
  function cancel() {
    if (active) { active.cancelled = true; active = null; }
    // Clear this coordinator's slot first: an abort listener may start a new job.
    runner.cancel();
  }
  return { request, cancel, pause(value = true) { if (typeof value !== 'boolean') throw new TypeError('Invalid pause state'); paused = value; if (paused) cancel(); },
    snapshot: () => ({ busy: runner.busy, paused, handled: handled.size, budget: budget.snapshot() }),
    dispose() { disposed = true; cancel(); unsubscribe(); runner.dispose(); } };
}
module.exports = { createAnalysisScheduler };
