'use strict';
const { record, text, number, freeze, fail } = require('./contracts.cjs');
function createAnalysisBudget({ capacity, windowMs, minIntervalMs, now = Date.now, initialState, reservationLimit = 4096 } = {}) {
  number(capacity, 1); number(windowMs, 1); number(minIntervalMs); number(reservationLimit, 1);
  let lastTime = number(now()), reservations = [];
  if (initialState !== undefined) {
    if (!record(initialState) || initialState.schemaVersion !== 1 || !Array.isArray(initialState.reservations) || initialState.reservations.length > reservationLimit) fail('INVALID_BUDGET_CHECKPOINT');
    const keys = new Set();
    reservations = initialState.reservations.map(row => {
      if (!record(row)) fail('INVALID_BUDGET_RESERVATION');
      const key = text(row.key, 512), at = number(row.at), cost = number(row.cost, 1);
      if (keys.has(key) || at > lastTime || !Number.isSafeInteger(at + windowMs) || !Number.isSafeInteger(at + minIntervalMs)) fail('INVALID_BUDGET_RESERVATION');
      keys.add(key); return { key, at, cost };
    }).sort((a, b) => a.at - b.at);
  }
  function time() { const at = number(now()); if (at < lastTime) fail('BUDGET_CLOCK_REVERSED'); lastTime = at; return at; }
  function sweep(at) {
    // Retain long intervals even when the cost window has already elapsed.
    reservations = reservations.filter(row => row.at + Math.max(windowMs, minIntervalMs) > at);
  }
  function spent(at) {
    const total = reservations.filter(row => row.at + windowMs > at).reduce((sum, row) => sum + row.cost, 0);
    if (!Number.isSafeInteger(total)) fail('INVALID_BUDGET_TOTAL'); return total;
  }
  function availableAt(at, cost) {
    const intervalAt = reservations.length ? reservations.at(-1).at + minIntervalMs : at;
    let used = spent(at), costAt = at;
    for (const row of reservations) if (used + cost > capacity && row.at + windowMs > at) { used -= row.cost; costAt = row.at + windowMs; }
    if (cost > capacity) return null;
    return Math.max(at, intervalAt, costAt);
  }
  function tryAcquire(key, cost = 1) {
    text(key, 512); number(cost, 1); const at = time(); sweep(at);
    if (reservations.some(row => row.key === key)) return { allowed: false, reason: 'duplicate', retryAt: null };
    if (cost > capacity || reservations.length >= reservationLimit) return { allowed: false, reason: 'capacity', retryAt: null };
    const retryAt = availableAt(at, cost);
    if (reservations.length && reservations.at(-1).at + minIntervalMs > at) return { allowed: false, reason: 'interval', retryAt };
    if (spent(at) + cost > capacity) return { allowed: false, reason: 'budget', retryAt };
    if (!Number.isSafeInteger(at + windowMs) || !Number.isSafeInteger(at + minIntervalMs)) fail('INVALID_BUDGET_TIME');
    reservations.push({ key, at, cost }); return { allowed: true, reason: 'allowed', retryAt: null };
  }
  function snapshot() {
    const at = time(); sweep(at); const used = spent(at);
    return freeze({ used, remaining: Math.max(0, capacity - used), capacity, reservations: reservations.length,
      nextAvailableAt: reservations.length >= reservationLimit ? null : availableAt(at, 1), windowMs, minIntervalMs });
  }
  function checkpoint() { const at = time(); sweep(at); return freeze({ schemaVersion: 1, reservations: reservations.map(row => ({ ...row })) }); }
  spent(lastTime);
  return { tryAcquire, snapshot, checkpoint };
}
module.exports = { createAnalysisBudget };
