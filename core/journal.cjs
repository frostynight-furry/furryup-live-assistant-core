'use strict';
const { createHash } = require('node:crypto');
const { number } = require('./contracts.cjs');
const STAGES = new Set(['session', 'event', 'provider', 'queue', 'feedback', 'memory']);
const CODES = new Set(['started', 'stopped', 'accepted', 'duplicate', 'invalid', 'foreign', 'preview', 'stale', 'full',
  'requested', 'cancelled', 'timeout', 'failed', 'observed', 'remembered', 'queued', 'displayed', 'expired',
  'adopted', 'rejected', 'dismissed', 'paused', 'resumed', 'cooldown', 'updated', 'unavailable']);
function createJournal({ now = Date.now, limit = 1000 } = {}) {
  number(limit, 1); const entries = []; let sequence = 0;
  function add(stage, code, id) {
    if (!STAGES.has(stage) || !CODES.has(code)) throw new TypeError('Unknown diagnostic state');
    const row = { sequence: ++sequence, at: now(), stage, code };
    // No event text, provider messages, credentials or raw identifiers in traces.
    if (typeof id === 'string') row.ref = createHash('sha256').update(id).digest('hex').slice(0, 24);
    entries.push(Object.freeze(row)); if (entries.length > limit) entries.shift();
  }
  return { add, snapshot: () => entries.map(row => ({ ...row })), clear: () => { entries.length = 0; } };
}
module.exports = { createJournal };
