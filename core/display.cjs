'use strict';
// Extracted display lifecycle. Ranking, timing and content are supplied by the host.
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
const clone = value => structuredClone(value);
function createDisplayLease({ now = Date.now, readingDuration, urgency, maxHoldMs, maxCards = 3, budgetLimit = 512 } = {}) {
  if (typeof readingDuration !== 'function' || typeof urgency !== 'function' ||
      !Number.isSafeInteger(maxHoldMs) || maxHoldMs < 0 || !Number.isSafeInteger(maxCards) || maxCards < 1 ||
      !Number.isSafeInteger(budgetLimit) || budgetLimit < 1) throw new TypeError('Explicit display policy is required');
  let scope = null, lease = null, validate = () => true;
  const budgets = new Map();
  function deadline() { return lease ? (lease.acknowledgedAt ?? lease.offeredAt) + lease.duration : 0; }
  function reading() { return Boolean(lease && lease.holdUntil > now() && lease.reasons.size); }
  function effectiveDeadline() { return reading() ? Math.max(deadline(), lease.holdUntil) : deadline(); }
  function valid() {
    if (!lease) return false;
    try { return validate(lease.suggestion) !== false; } catch { return false; }
  }
  function clear() {
    if (lease) { lease.reasons.delete('pointer'); lease.reasons.delete('focus'); }
    lease = null;
  }
  function publicSuggestion() {
    const copy = clone(lease.suggestion);
    copy.sourceExpiresAt = copy.expiresAt;
    copy.displayUntil = Math.max(Number.isFinite(copy.expiresAt) ? copy.expiresAt : 0, effectiveDeadline());
    copy.displayedAt = lease.acknowledgedAt;
    copy.minimumDisplayUntil = deadline();
    copy.reading = { active: reading(), manual: reading() && lease.reasons.has('manual'),
      until: reading() ? lease.holdUntil : null, available: lease.holdUntil === null || now() < lease.holdUntil };
    copy.expiresAt = copy.displayUntil;
    return copy;
  }
  function select(candidates = [], { scope: nextScope = '', present = false, valid: nextValidate = () => true } = {}) {
    if (scope !== nextScope) { clear(); budgets.clear(); scope = nextScope; }
    validate = nextValidate;
    const at = now();
    const available = candidates.filter(row => row && validId(row.id));
    if (lease && !valid()) clear();
    // Genuine urgent events can interrupt reading, but equivalent-priority
    // traffic cannot repeatedly steal the card currently being read.
    if (lease && available[0]?.id !== lease.suggestion.id && urgency(available[0]) > urgency(lease.suggestion)) clear();
    if (lease && at >= effectiveDeadline()) {
      // Keep the acknowledgement of an unchanged card. Repeated renderer
      // refreshes must never start another reading period for the same card.
      if (available[0]?.id === lease.suggestion.id) lease.suggestion = clone(available[0]);
      else clear();
    }
    if (!lease && present && available[0]) {
      // Interruptions must not grant the same ID another reading/hold budget.
      // Keep the original first paint and deadline if it returns after an interruption.
      lease = budgets.get(available[0].id);
      if (lease) lease.suggestion = clone(available[0]);
      else {
        lease = { suggestion: clone(available[0]), offeredAt: at,
          acknowledgedAt: null, duration: readingDuration(available[0]), reasons: new Set(), holdUntil: null };
        budgets.set(available[0].id, lease);
      }
      while (budgets.size > budgetLimit) budgets.delete(budgets.keys().next().value);
    }
    if (!lease) return available.slice(0, maxCards).map(clone);
    return [publicSuggestion(), ...available.filter(row => row.id !== lease.suggestion.id).slice(0, maxCards - 1).map(clone)];
  }
  function acknowledge(id) {
    if (!validId(id) || lease?.suggestion.id !== id || !valid()) return false;
    if (lease.acknowledgedAt !== null) return false;
    // The renderer may have been suspended before its first paint. The host
    // synchronizes selection first, removing an obsolete offer; an unchanged,
    // still eligible source card receives its first lease at the actual paint.
    lease.acknowledgedAt = now(); return true;
  }
  function lookup(id) {
    if (lease?.suggestion.id !== id || now() >= effectiveDeadline() || !valid()) return null;
    return publicSuggestion();
  }
  function interact({ id, reason, active } = {}) {
    if (!validId(id) || lease?.suggestion.id !== id || !['pointer', 'focus', 'manual'].includes(reason) ||
        typeof active !== 'boolean' || !valid()) return false;
    if (active) {
      // One bounded budget per card. Pointer motion, refocusing, heartbeats,
      // renderer reloads and repeated clicks must not renew it indefinitely.
      if (lease.holdUntil === null) lease.holdUntil = now() + maxHoldMs;
      if (now() >= lease.holdUntil || lease.reasons.has(reason)) return false;
      lease.reasons.add(reason);
    } else if (reason === 'manual') {
      lease.reasons.clear();
      // “继续” releases a deliberate pause immediately, including the pointer
      // and focus left over from clicking the same control.
      lease.duration = Math.min(lease.duration, now() - (lease.acknowledgedAt ?? lease.offeredAt));
    } else {
      if (!lease.reasons.delete(reason)) return false;
    }
    return true;
  }
  function replace(id, suggestion) {
    if (!validId(id) || lease?.suggestion.id !== id || suggestion?.id !== id ||
        now() >= Math.max(Number.isFinite(lease.suggestion.expiresAt) ? lease.suggestion.expiresAt : 0, effectiveDeadline()) || !valid()) return false;
    // Only the trusted host can resolve alternatives. Keep the original
    // source lifetime and all reading budgets while changing its wording.
    lease.suggestion = { ...clone(suggestion), createdAt: lease.suggestion.createdAt,
      expiresAt: lease.suggestion.expiresAt };
    return true;
  }
  function release(id) { if (lease?.suggestion.id !== id) return false; clear(); return true; }
  return { select, acknowledge, lookup, release, clear, interact, replace };
}

module.exports = { createDisplayLease };
