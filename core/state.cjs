'use strict';
const { isDeepStrictEqual } = require('node:util');
const { record, text, number, json, freeze, fail } = require('./contracts.cjs');
function createRealtimeState({ now = Date.now, limit = 64 } = {}) {
  number(limit, 1);
  let scope = null, generation = 0, revision = 0, facts = new Map();
  const listeners = new Set();
  const time = () => number(now());
  function notify() {
    const event = Object.freeze({ scope, generation, revision });
    for (const listener of [...listeners]) { try { listener(event); } catch { /* Observers cannot break state transitions. */ } }
  }
  function sweep(at = time()) {
    let changed = false;
    for (const fact of facts.values()) if (fact.status === 'fresh' && fact.expiresAt <= at) {
      fact.status = 'stale'; fact.revision++; changed = true;
    }
    if (changed) { revision++; notify(); }
  }
  function start(value) {
    text(value, 512); scope = value; generation++; revision++; facts = new Map(); notify();
  }
  function stop() { scope = null; generation++; revision++; facts = new Map(); notify(); }
  function patch(inputs) {
    if (scope === null) fail('STATE_UNAVAILABLE');
    if (!Array.isArray(inputs) || inputs.length > limit) fail('INVALID_FACT_PATCH');
    const at = time(), incoming = new Set(), next = new Map();
    // Validate the entire candidate before expiry or value transitions are committed.
    for (const input of inputs) {
      if (!record(input)) fail('INVALID_FACT');
      const key = text(input.key, 128), source = text(input.source, 256);
      if (['__proto__', 'constructor', 'prototype'].includes(key) || incoming.has(key)) fail('INVALID_FACT_KEY');
      incoming.add(key);
      const observedAt = number(input.observedAt), ttlMs = number(input.ttlMs, 1);
      if (observedAt > at || !Number.isSafeInteger(observedAt + ttlMs)) fail('INVALID_FACT_TIME');
      if (!['known', 'unknown'].includes(input.status)) fail('INVALID_FACT_STATUS');
      if (input.status === 'unknown' && input.value !== undefined && input.value !== null) fail('INVALID_UNKNOWN_VALUE');
      const value = input.status === 'known' ? json(input.value) : null;
      const previous = facts.get(key);
      if (previous && observedAt < previous.observedAt) fail('OUT_OF_ORDER_FACT');
      const expiresAt = observedAt + ttlMs, status = input.status === 'unknown' ? 'unknown' : expiresAt <= at ? 'stale' : 'fresh';
      next.set(key, { key, source, status, value, observedAt, expiresAt, revision: previous?.revision || 0,
        reason: input.reason == null ? null : text(input.reason, 128) });
    }
    if (new Set([...facts.keys(), ...incoming]).size > limit) fail('FACT_CAPACITY');
    const combined = Object.fromEntries([...facts, ...next]); json(combined);
    let changed = false;
    // Expiry remains observable even when the same value is refreshed in this patch.
    for (const [key, previous] of facts) if (previous.status === 'fresh' && previous.expiresAt <= at) {
      previous.status = 'stale'; previous.revision++; changed = true;
      if (next.has(key)) next.get(key).revision = previous.revision;
    }
    for (const [key, fact] of next) {
      const previous = facts.get(key);
      if (!previous || previous.source !== fact.source || previous.status !== fact.status || previous.reason !== fact.reason || !isDeepStrictEqual(previous.value, fact.value)) {
        fact.revision++; changed = true;
      }
      facts.set(key, fact);
    }
    if (changed) { revision++; notify(); }
    return changed;
  }
  function snapshot() {
    const at = time(); sweep(at);
    return freeze({ active: scope !== null, scope, generation, revision, at, facts: Object.fromEntries([...facts].map(([key, value]) => [key, structuredClone(value)])) });
  }
  function capture(keys) {
    sweep(); if (scope === null) fail('STATE_UNAVAILABLE');
    if (keys !== undefined && (!Array.isArray(keys) || keys.length > limit || new Set(keys).size !== keys.length)) fail('INVALID_DEPENDENCIES');
    const selected = keys === undefined ? [...facts.keys()].sort() : keys.map(key => text(key, 128));
    return freeze({ scope, generation, revision, all: keys === undefined,
      versions: selected.map(key => ({ key, revision: facts.get(key)?.revision || 0 })) });
  }
  function isCurrent(token) {
    sweep();
    if (!record(token) || scope === null || token.scope !== scope || token.generation !== generation || typeof token.all !== 'boolean' ||
      !Number.isSafeInteger(token.revision) || !Array.isArray(token.versions) || token.versions.length > limit) return false;
    if (token.all && token.revision !== revision) return false;
    const keys = new Set();
    return token.versions.every(row => {
      if (!record(row) || typeof row.key !== 'string' || !row.key.length || keys.has(row.key) || !Number.isSafeInteger(row.revision) || row.revision < 0) return false;
      keys.add(row.key); return row.revision === (facts.get(row.key)?.revision || 0);
    });
  }
  function subscribe(listener) { if (typeof listener !== 'function') throw new TypeError('State listener required'); listeners.add(listener); return () => listeners.delete(listener); }
  return { start, stop, patch, snapshot, capture, isCurrent, subscribe };
}
module.exports = { createRealtimeState };
