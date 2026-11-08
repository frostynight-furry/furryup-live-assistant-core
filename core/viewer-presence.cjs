'use strict';
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const PLATFORMS = Object.freeze(['bilibili', 'douyin', 'kuaishou', 'wechat_channels']);

const DWELL_MS = 60_000;
const MAX_OBSERVATION_GAP_MS = 30_000;
const REMINDER_COOLDOWN_MS = 600_000;
const DEFAULT_VIEWER_PRESENCE_SETTINGS = Object.freeze({ enabled: true, platforms: Object.freeze(
  Object.fromEntries(PLATFORMS.map(platform => [platform, Object.freeze({ userLevel: null, wealthLevel: null })]))) });
const clean = (value, max = 128) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
const level = value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000 ? value : null;
const timestamp = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const sourceReliable = value => Boolean(value) && !/(?:^|-)(?:simulation|preview|mock|unknown|cumulative|contribution|historical|replay)(?:-|$)/i.test(value);
const subjectKey = (platform, roomId, userId) => createHash('sha256').update(JSON.stringify([platform, roomId, userId])).digest('hex');
const stableId = value => {
  if (typeof value === 'number') value = Number.isSafeInteger(value) && value > 0 ? String(value) : '';
  return typeof value === 'string' && value.trim() && value.length <= 256 &&
    !/[\u0000-\u0020\u007f]/.test(value) && !['0', 'unknown', 'anonymous'].includes(value.toLowerCase()) ? value : '';
};

function normalizeSettings(value) {
  if (!value || typeof value.enabled !== 'boolean' || !value.platforms || Array.isArray(value.platforms) ||
      Object.keys(value.platforms).some(key => !PLATFORMS.includes(key))) throw new TypeError('观众停留提醒配置无效');
  const platforms = Object.fromEntries(PLATFORMS.map(platform => {
    const row = value.platforms[platform];
    if (!row || !['userLevel', 'wealthLevel'].every(key => row[key] === null || level(row[key]) !== null))
      throw new TypeError('请为四个平台填写等级门槛，或留空');
    return [platform, { userLevel: row.userLevel, wealthLevel: row.wealthLevel }];
  }));
  return { enabled: value.enabled, platforms };
}

function createViewerPresence({ now = Date.now, monotonicNow = () => performance.now(), getSettings = () => undefined } = {}) {
  let settings = normalizeSettings(DEFAULT_VIEWER_PRESENCE_SETTINGS), settingsKey = JSON.stringify(settings);
  let managed = false, disposed = false, sequence = 0, lastTick = null;
  const consumed = new Map();
  const states = new Map(PLATFORMS.map(platform => [platform, {
    platform, roomId: '', active: false, connectionReady: false, eventOffline: false, status: 'unconfigured', source: '', observedAt: null,
    lastMono: null, revision: null, minimumAt: null, viewers: new Map()
  }]));
  const clear = (state, status = state.status) => { state.viewers.clear(); state.lastMono = null; state.status = status; };

  function clock() {
    const wall = timestamp(now()), mono = monotonicNow();
    if (wall === null || !Number.isFinite(mono) || mono < 0) { for (const state of states.values()) clear(state, 'unavailable'); return null; }
    // A wall-clock adjustment never contributes to dwell time. Reset existing
    // evidence on clock discontinuities, including a suspended monotonic clock.
    if (lastTick && (mono < lastTick.mono || Math.abs((wall - lastTick.wall) - (mono - lastTick.mono)) > 5_000))
      for (const state of states.values()) { clear(state, 'stale'); state.observedAt = null; state.revision = null; state.minimumAt = wall; }
    lastTick = { wall, mono };
    for (const [key, received] of consumed) if (mono - received >= REMINDER_COOLDOWN_MS) consumed.delete(key);
    for (const state of states.values()) if (state.lastMono !== null && mono - state.lastMono >= MAX_OBSERVATION_GAP_MS) clear(state, 'stale');
    let supplied;
    try { supplied = getSettings(); } catch { supplied = undefined; }
    if (supplied !== undefined) configure(supplied);
    return { wall, mono };
  }

  function reason(platform, viewer) {
    const rule = settings.platforms[platform], parts = [];
    if (platform === 'kuaishou' && viewer.highWealth === true) parts.push('平台高财富标记');
    if (rule.userLevel !== null && viewer.userLevel !== null && viewer.userLevel >= rule.userLevel) parts.push(`用户等级 ${viewer.userLevel} ≥ ${rule.userLevel}`);
    if (rule.wealthLevel !== null && viewer.wealthLevel !== null && viewer.wealthLevel >= rule.wealthLevel) parts.push(`财富等级 ${viewer.wealthLevel} ≥ ${rule.wealthLevel}`);
    return parts.join('；');
  }

  function configure(value) {
    const next = normalizeSettings(value), key = JSON.stringify(next);
    if (key !== settingsKey) {
      for (const state of states.values()) if (settings.enabled !== next.enabled) clear(state, state.active ? 'unknown' : state.status);
      settings = next; settingsKey = key;
    }
    return normalizeSettings(settings);
  }

  function sync(connections = []) {
    if (disposed) return false;
    const at = clock(); if (!at) return false;
    managed = true;
    const rows = new Map((Array.isArray(connections) ? connections : []).map(row => [row?.platform, row]));
    for (const state of states.values()) {
      const row = rows.get(state.platform), roomId = clean(row?.roomId);
      if (state.roomId !== roomId) state.eventOffline = false;
      state.connectionReady = Boolean(roomId) && ['connected', 'receiving'].includes(row?.state) && row?.roomLiveStatus !== false &&
        !['offline', 'ended', 'stopped', 'waiting'].includes(String(row?.roomLiveStatus || '').toLowerCase()) && !row?.errorCode;
      const active = state.connectionReady && !state.eventOffline;
      if (state.roomId !== roomId || state.active !== active) {
        clear(state, active ? 'unknown' : roomId ? 'disconnected' : 'unconfigured');
        state.observedAt = null; state.revision = null; state.source = ''; state.minimumAt = at.wall;
      }
      state.roomId = roomId; state.active = active;
      if (!active) clear(state, roomId ? 'disconnected' : 'unconfigured');
    }
    return true;
  }

  function observe(value) {
    if (disposed || !value || !PLATFORMS.includes(value.platform)) return false;
    const at = clock(), state = states.get(value.platform), roomId = clean(value.roomId), observedAt = timestamp(value.observedAt);
    if (!at || state.eventOffline || !roomId || observedAt === null || observedAt > at.wall || at.wall - observedAt >= MAX_OBSERVATION_GAP_MS) return false;
    if (managed && (!state.active || roomId !== state.roomId || observedAt < state.minimumAt)) return false;
    if (!managed && state.roomId !== roomId) {
      clear(state, 'unknown'); state.observedAt = null; state.revision = null; state.source = '';
    }
    if (state.observedAt !== null && observedAt <= state.observedAt) return false;
    const revision = value.revision;
    if (revision !== undefined && revision !== null && (!Number.isSafeInteger(revision) || revision < 0)) return false;
    if (state.source === clean(value.source) && revision !== undefined && revision !== null && state.revision !== null && revision <= state.revision) return false;
    if (state.source && state.source !== clean(value.source)) clear(state, 'unknown');
    state.roomId = roomId; state.active = managed ? state.active : value.status === 'live';
    state.observedAt = observedAt; state.revision = revision ?? null; state.source = clean(value.source);
    const reliable = value.status === 'live' && sourceReliable(state.source) && value.presenceEvidence === 'online-list' && typeof value.complete === 'boolean' && Array.isArray(value.viewers);
    if (!reliable || !settings.enabled) { clear(state, value.status === 'unavailable' ? 'unavailable' : 'unknown'); return true; }
    state.status = 'live'; state.lastMono = at.mono;
    const present = new Map(), seen = new Set();
    for (const raw of value.viewers.slice(0, 10_000)) {
      const userId = stableId(raw?.userId);
      if (!userId) continue;
      // Conflicting duplicate rows cannot constitute reliable presence evidence.
      if (seen.has(userId)) { present.set(userId, null); continue; }
      seen.add(userId);
      if (raw.online !== true) continue;
      const data = { userId, userName: clean(raw.userName, 64) || '这位观众', userLevel: level(raw.userLevel), wealthLevel: level(raw.wealthLevel),
        highWealth: state.platform === 'kuaishou' && state.source === 'kuaishou-live-watching-list' && raw.highWealth === true };
      const previous = state.viewers.get(userId);
      present.set(userId, { ...data, since: previous?.since ?? at.mono, subject: subjectKey(state.platform, roomId, userId),
        id: previous?.id || createHash('sha256').update(JSON.stringify([state.platform, roomId, userId, ++sequence])).digest('hex'),
        consumed: previous?.consumed || false });
    }
    state.viewers = new Map([...present].filter(([, row]) => row));
    return true;
  }

  function ingest(event) {
    if (disposed || !event || event.preview || event.simulation || event.source === 'simulation' || !PLATFORMS.includes(event.platform)) return false;
    if (event.event_type === 'live_status') {
      const state = states.get(event.platform), roomId = clean(event.room_id), at = clock(), receivedAt = timestamp(event.received_at);
      if (!at || roomId && state.roomId && roomId !== state.roomId || receivedAt !== null &&
          (receivedAt > at.wall || at.wall - receivedAt >= MAX_OBSERVATION_GAP_MS)) return false;
      const status = String(event.live_status ?? '').toLowerCase();
      if (event.live_status !== false && !['ended', 'offline', 'stopped', 'started', 'live', 'online'].includes(status)) return false;
      const wasOffline = state.eventOffline;
      state.eventOffline = event.live_status === false || ['ended', 'offline', 'stopped'].includes(status);
      state.active = !state.eventOffline && (!managed || state.connectionReady);
      if (wasOffline || state.eventOffline) {
        clear(state, state.eventOffline ? 'disconnected' : 'unknown');
        state.observedAt = null; state.revision = null; state.minimumAt = at.wall;
      }
      if (roomId) state.roomId = roomId;
      return true;
    }
    if (event.event_type !== 'viewer_snapshot' || !event.viewer_snapshot) return false;
    return observe({ ...event.viewer_snapshot, platform: event.platform, roomId: event.room_id,
      observedAt: event.received_at, status: event.viewer_snapshot.status || 'live' });
  }

  function candidates() {
    if (disposed) return [];
    const at = clock(); if (!at || !settings.enabled) return [];
    const result = [];
    for (const state of states.values()) if (state.active && state.status === 'live') for (const viewer of state.viewers.values()) {
      const why = reason(state.platform, viewer);
      if (viewer.consumed || consumed.has(viewer.subject) || state.lastMono - viewer.since < DWELL_MS || !why) continue;
      result.push({ id: viewer.id, platform: state.platform, roomId: state.roomId, userId: viewer.userId,
        userName: viewer.userName, elapsedSeconds: Math.floor((state.lastMono - viewer.since) / 1000), reason: why,
        userLevel: viewer.userLevel, wealthLevel: viewer.wealthLevel, highWealth: viewer.highWealth, observedAt: state.observedAt, source: state.source });
    }
    return result;
  }

  function findValid(id) {
    const at = clock(); if (disposed || !at || !settings.enabled || typeof id !== 'string') return null;
    for (const state of states.values()) if (state.active && state.status === 'live') for (const viewer of state.viewers.values())
      if (viewer.id === id && (viewer.consumed || !consumed.has(viewer.subject)) && state.lastMono - viewer.since >= DWELL_MS && reason(state.platform, viewer)) return viewer;
    return null;
  }
  function valid(id) { return Boolean(findValid(id)); }
  function consume(id) {
    const viewer = findValid(id); if (!viewer || viewer.consumed) return false;
    viewer.consumed = true; consumed.set(viewer.subject, lastTick.mono);
    while (consumed.size > 20_000) consumed.delete(consumed.keys().next().value);
    return true;
  }

  function snapshot({ connections } = {}) {
    if (connections !== undefined) sync(connections); else clock();
    return { enabled: settings.enabled && !disposed, dwellSeconds: 60, platforms: PLATFORMS.map(platform => {
      const state = states.get(platform), rule = settings.platforms[platform];
      const highWealthSupported = platform === 'kuaishou' && state.source === 'kuaishou-live-watching-list';
      let statusText = !settings.enabled ? '提醒已关闭' :
        ({ live: '正在核验当前在线观众', unknown: '当前榜单不能证明观众在线', unavailable: '当前在线名单暂不可用',
          stale: '在线名单未及时更新，已中断计时', disconnected: '连接已断开，已中断计时', unconfigured: '请先连接直播间' })[state.status];
      if (settings.enabled && rule.userLevel === null && rule.wealthLevel === null)
        statusText += highWealthSupported ? '；已启用平台高财富标记' : '；先设置等级门槛';
      return { platform, roomId: state.roomId, status: state.status, statusText, source: state.source,
        observedAt: state.observedAt, presenceEvidence: state.status === 'live' ? 'online-list' : 'unknown', highWealthSupported, trackedCount: state.viewers.size,
        qualifiedCount: [...state.viewers.values()].filter(viewer => reason(platform, viewer)).length,
        userLevelThreshold: rule.userLevel, wealthLevelThreshold: rule.wealthLevel };
    }) };
  }
  function reset() {
    for (const state of states.values()) {
      clear(state, state.active ? 'unknown' : state.roomId ? 'disconnected' : 'unconfigured');
      state.observedAt = null; state.revision = null; state.source = '';
      state.eventOffline = false;
    }
    lastTick = null;
    consumed.clear();
  }
  function dispose() { reset(); disposed = true; }
  return { ingest, observe, sync, snapshot, candidates, consume, valid, configure, reset, dispose };
}

module.exports = { createViewerPresence, normalizeSettings, DEFAULT_VIEWER_PRESENCE_SETTINGS, DWELL_MS, MAX_OBSERVATION_GAP_MS, REMINDER_COOLDOWN_MS };
