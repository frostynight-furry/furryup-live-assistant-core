'use strict';
const { text, event } = require('./contracts.cjs');
// Projection of the published LiveConnect v1 envelope, not a platform collector.
// Text/identities/raw payload are excluded unless a host explicitly projects them.
function createLiveConnectAdapter({ scope, rooms, allowSimulation = false, project = () => ({}) } = {}) {
  text(scope, 512);
  if (!Array.isArray(rooms) || !rooms.length || typeof project !== 'function') throw new TypeError('Explicit room bindings are required');
  const allowed = new Set(rooms.map(row => JSON.stringify([text(row.platform, 80), text(row.roomId, 256)])));
  function adapt(row) {
    if (!row || row.schemaVersion !== 1 || typeof row.preview !== 'boolean') return null;
    if ((row.preview || row.source === 'simulation') && !allowSimulation) return null;
    if (!allowed.has(JSON.stringify([row.platform, row.room_id]))) return null;
    try {
      return event({ id: JSON.stringify([row.platform, row.room_id, text(row.event_id, 256)]), scope,
        type: row.event_type, at: row.received_at, data: project(structuredClone(row)) });
    } catch { return null; }
  }
  return { adapt };
}
module.exports = { createLiveConnectAdapter };
