'use strict';
const { number, suggestion } = require('./contracts.cjs');
function createSuggestionQueue({ now = Date.now, limit = 64, historyLimit = 512, onTransition = () => {} } = {}) {
  number(limit, 1); number(historyLimit, 1);
  const pending = new Map(), completed = new Map(), cooldowns = new Map();
  let current = null, paused = false, sequence = 0;
  function emit(code, id) { try { onTransition(code, id); } catch { /* Diagnostics cannot interrupt delivery. */ } }
  function finish(item, state) {
    if (!item) return;
    pending.delete(item.value.id); if (current === item) current = null;
    completed.set(item.value.id, { id: item.value.id, state, at: now() });
    while (completed.size > historyLimit) completed.delete(completed.keys().next().value);
    emit(state, item.value.id);
  }
  function sweep() {
    for (const [key, until] of cooldowns) if (until <= now()) cooldowns.delete(key);
    for (const item of [...pending.values(), ...(current ? [current] : [])]) if (item.value.expiresAt <= now()) finish(item, 'expired');
  }
  function offer(input) {
    const value = suggestion(input, now()); sweep();
    if (value.expiresAt <= now()) { emit('expired', value.id); return false; }
    if (pending.has(value.id) || current?.value.id === value.id || completed.has(value.id)) { emit('duplicate', value.id); return false; }
    if ((cooldowns.get(value.cooldownKey) ?? 0) > now()) { emit('cooldown', value.id); return false; }
    if (pending.size + (current ? 1 : 0) >= limit || value.cooldownMs && cooldowns.size >= historyLimit) { emit('full', value.id); return false; }
    pending.set(value.id, { value, sequence: ++sequence });
    if (value.cooldownMs) cooldowns.set(value.cooldownKey, now() + value.cooldownMs);
    emit('queued', value.id); return true;
  }
  function present() {
    sweep();
    // Current cards remain stable. The caller explicitly dismisses or cancels them.
    if (!current) {
      const choices = [...pending.values()].filter(row => !paused || row.value.urgent)
        .sort((a, b) => b.value.priority - a.value.priority || a.sequence - b.sequence);
      current = choices[0] || null;
      if (current) { pending.delete(current.value.id); emit('displayed', current.value.id); }
    }
    return current ? structuredClone(current.value) : null;
  }
  function decide(id, state) {
    if (!['adopted', 'rejected', 'dismissed'].includes(state)) throw new TypeError('Invalid decision');
    sweep(); if (current?.value.id !== id) return false;
    finish(current, state); return true;
  }
  function cancel(id) { const item = current?.value.id === id ? current : pending.get(id); if (!item) return false; finish(item, 'cancelled'); return true; }
  function clear() {
    for (const item of [...pending.values(), ...(current ? [current] : [])]) finish(item, 'cancelled');
    completed.clear(); cooldowns.clear(); paused = false;
  }
  function pause(value = true) { if (typeof value !== 'boolean') throw new TypeError('Invalid pause state'); if (paused !== value) { paused = value; emit(value ? 'paused' : 'resumed'); } }
  function snapshot() { sweep(); return { paused, current: current ? structuredClone(current.value) : null,
    pending: [...pending.values()].sort((a, b) => b.value.priority - a.value.priority || a.sequence - b.sequence).map(row => structuredClone(row.value)),
    history: [...completed.values()].map(row => ({ ...row })) }; }
  return { offer, present, decide, cancel, clear, pause, snapshot };
}
module.exports = { createSuggestionQueue };
