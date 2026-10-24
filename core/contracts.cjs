'use strict';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function text(value, max, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail('INVALID_TEXT');
  return value;
}
function number(value, min = 0) { if (!Number.isSafeInteger(value) || value < min) fail('INVALID_NUMBER'); return value; }
function json(value, maxBytes = 65536) {
  function visit(item, depth) {
    if (depth > 12) fail('DATA_TOO_DEEP');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return;
    if (typeof item === 'number' && Number.isFinite(item)) return;
    if (!Array.isArray(item) && !record(item)) fail('INVALID_DATA');
    for (const [key, child] of Object.entries(item)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('UNSAFE_KEY');
      visit(child, depth + 1);
    }
  }
  visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) fail('DATA_TOO_LARGE');
  return structuredClone(value);
}
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function event(value) {
  if (!record(value)) fail('INVALID_EVENT');
  return freeze({ id: text(value.id, 512), scope: text(value.scope, 512), type: text(value.type, 80),
    at: number(value.at), data: json(value.data ?? {}) });
}
function suggestion(value, at) {
  if (!record(value)) fail('INVALID_SUGGESTION');
  const createdAt = number(value.createdAt ?? at), expiresAt = number(value.expiresAt);
  if (createdAt > at || expiresAt <= createdAt) fail('INVALID_LIFETIME');
  if (value.urgent !== undefined && typeof value.urgent !== 'boolean') fail('INVALID_URGENCY');
  return freeze({ id: text(value.id, 256), title: text(value.title, 200), message: text(value.message, 4000),
    evidence: text(value.evidence ?? '', 2000, true), priority: number(value.priority ?? 0, -1000000),
    urgent: value.urgent === true, createdAt, expiresAt,
    cooldownKey: text(value.cooldownKey ?? value.id, 256), cooldownMs: number(value.cooldownMs ?? 0) });
}
function decision(value, at) {
  if (!record(value) || !['observe', 'remember', 'suggest'].includes(value.mode)) fail('INVALID_DECISION');
  if (value.mode === 'observe') return Object.freeze({ mode: 'observe' });
  if (value.mode === 'remember') return freeze({ mode: 'remember', memory: json(value.memory) });
  if (!Array.isArray(value.suggestions) || !value.suggestions.length || value.suggestions.length > 64) fail('INVALID_SUGGESTIONS');
  return freeze({ mode: 'suggest', suggestions: value.suggestions.map(row => suggestion(row, at)) });
}
module.exports = { record, text, number, json, freeze, event, suggestion, decision, fail };
