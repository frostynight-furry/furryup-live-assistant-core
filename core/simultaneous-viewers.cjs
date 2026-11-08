'use strict';
const PLATFORMS = Object.freeze(['bilibili', 'douyin', 'kuaishou', 'wechat_channels']);

const FRESHNESS_MS = 90_000;
const MINUTE_MS = 60_000;
const MAX_TIMELINE = 2880;
const MAX_COUNT = 1_000_000_000_000;
const MAX_TOTAL = MAX_COUNT * PLATFORMS.length;
const MAX_TIME = 8_640_000_000_000_000;
const NOTE = '四平台同一观测时刻的最新原始在线人数合计，采样有效期 90 秒；缺失不按 0 处理，跨平台未去重；平均值按四平台完整覆盖时长加权。';
const integer = (value, max = MAX_TIME) => Number.isSafeInteger(value) && value >= 0 && value <= max ? value : null;
const average = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_TOTAL ? value : null;
const weightedAverage = (weighted, duration) => duration ? Math.min(MAX_TOTAL, Math.max(0, weighted / duration)) : null;
const object = value => value && typeof value === 'object' && !Array.isArray(value);

// This is also the archive boundary: no room IDs, identities, arbitrary text,
// unknown platforms, or unbounded arrays survive a second public read/write.
function publicSimultaneousViewers(value) {
  if (!object(value) || value.schemaVersion !== 1 || value.scope !== 'four-platforms' || !object(value.current)) return null;
  const at = integer(value.current.at);
  if (at === null) return null;
  const sourceCounts = Array.isArray(value.current.counts) ? value.current.counts.slice(0, 32) : [];
  const counts = PLATFORMS.map(platform => {
    const source = sourceCounts.find(row => object(row) && row.platform === platform);
    const sampledAt = integer(source?.sampledAt);
    const watching = sampledAt !== null && sampledAt <= at && at - sampledAt < FRESHNESS_MS ? integer(source?.watching, MAX_COUNT) : null;
    return { platform, watching, sampledAt };
  });
  const missingPlatforms = counts.filter(row => row.watching === null).map(row => row.platform);
  const observed = counts.filter(row => row.watching !== null);
  const observedTotal = observed.length ? observed.reduce((total, row) => total + row.watching, 0) : null;
  const complete = missingPlatforms.length === 0;
  const sourcePeak = Array.isArray(value.peakCounts) ? value.peakCounts.slice(0, 32) : [];
  let peak = integer(value.peak, MAX_TOTAL), peakAt = integer(value.peakAt);
  let peakCounts = PLATFORMS.map(platform => ({ platform,
    watching: integer(sourcePeak.find(row => object(row) && row.platform === platform)?.watching, MAX_COUNT) }));
  if (peak === null || peakAt === null || peakAt > at || peakCounts.some(row => row.watching === null) ||
      peakCounts.reduce((total, row) => total + row.watching, 0) !== peak) {
    peak = null; peakAt = null; peakCounts = [];
  }
  const elapsedMs = integer(value.elapsedMs) ?? 0;
  const coveredMs = Math.min(integer(value.coveredMs) ?? 0, elapsedMs);
  const byMinute = new Map();
  const inputTimeline = Array.isArray(value.timeline) ? value.timeline : [];
  for (const row of inputTimeline.slice(-MAX_TIMELINE)) {
    if (!object(row)) continue;
    const minuteAt = integer(row.at);
    if (minuteAt === null || minuteAt % MINUTE_MS !== 0 || minuteAt > at) continue;
    const duration = integer(row.coveredMs, MINUTE_MS) ?? 0;
    const minutePeak = integer(row.peak, MAX_TOTAL);
    const minutePeakAt = integer(row.peakAt);
    const validPeak = minutePeak !== null && minutePeakAt !== null && minutePeakAt >= minuteAt &&
      minutePeakAt < minuteAt + MINUTE_MS && minutePeakAt <= at;
    byMinute.set(minuteAt, { at: minuteAt, coveredMs: duration, average: duration ? average(row.average) : null,
      peak: validPeak ? minutePeak : null, peakAt: validPeak ? minutePeakAt : null });
  }
  return { schemaVersion: 1, scope: 'four-platforms', freshnessMs: FRESHNESS_MS,
    current: { at, total: complete ? observedTotal : null, observedTotal, complete, counts, missingPlatforms },
    peak, peakAt, peakCounts, average: coveredMs ? average(value.average) : null,
    averageMode: 'time-weighted-complete-coverage', coveredMs, elapsedMs,
    coverageRatio: elapsedMs ? coveredMs / elapsedMs : 0,
    timeline: [...byMinute.values()].sort((left, right) => left.at - right.at),
    timelineTruncated: value.timelineTruncated === true || inputTimeline.length > MAX_TIMELINE, note: NOTE };
}

function createSimultaneousViewers({ startedAt = Date.now() } = {}) {
  if (integer(startedAt) === null) throw new Error('同时在线记录开始时间无效');
  let cursor = startedAt, stopped = false, coveredMs = 0, weightedTotal = 0;
  let peak = null, peakAt = null, peakCounts = [], timelineTruncated = false;
  let samples = PLATFORMS.map(platform => ({ platform, active: false, watching: null, sampledAt: null }));
  const timeline = new Map();
  function current(at) {
    const counts = samples.map(row => ({ platform: row.platform,
      watching: row.active && row.sampledAt !== null && row.sampledAt <= at && at - row.sampledAt < FRESHNESS_MS ? row.watching : null,
      sampledAt: row.sampledAt }));
    const known = counts.filter(row => row.watching !== null);
    const missingPlatforms = counts.filter(row => row.watching === null).map(row => row.platform);
    const observedTotal = known.length ? known.reduce((total, row) => total + row.watching, 0) : null;
    return { at, total: missingPlatforms.length ? null : observedTotal, observedTotal,
      complete: missingPlatforms.length === 0, counts, missingPlatforms };
  }
  function minute(at) {
    const minuteAt = Math.floor(at / MINUTE_MS) * MINUTE_MS;
    if (!timeline.has(minuteAt)) timeline.set(minuteAt, { at: minuteAt, coveredMs: 0, weightedTotal: 0, peak: null, peakAt: null });
    while (timeline.size > MAX_TIMELINE) { timeline.delete(timeline.keys().next().value); timelineTruncated = true; }
    return timeline.get(minuteAt);
  }
  function minutePeak(at, total) {
    const row = minute(at);
    if (row.peak === null || total > row.peak) { row.peak = total; row.peakAt = at; }
    return row;
  }
  function recordPeak(at) {
    const value = current(at);
    if (!value.complete) return;
    minutePeak(at, value.total);
    if (peak === null || value.total > peak) {
      peak = value.total; peakAt = at;
      peakCounts = value.counts.map(({ platform, watching }) => ({ platform, watching }));
    }
  }
  function advance(at) {
    if (stopped || integer(at) === null || at <= cursor) return;
    const value = current(cursor);
    if (value.complete) {
      const end = Math.min(at, ...samples.map(row => row.sampledAt + FRESHNESS_MS));
      let position = cursor;
      // At most the remaining 90 seconds can be covered. A long idle gap never
      // creates synthetic complete minutes or carries expired counts forward.
      while (position < end) {
        const stop = Math.min(end, (Math.floor(position / MINUTE_MS) + 1) * MINUTE_MS);
        const duration = stop - position;
        const row = minutePeak(position, value.total);
        row.coveredMs += duration; row.weightedTotal += value.total * duration;
        coveredMs += duration; weightedTotal += value.total * duration;
        position = stop;
      }
    }
    cursor = at;
  }
  function update(at, rows) {
    if (stopped || integer(at) === null || at < cursor) return;
    advance(at);
    samples = PLATFORMS.map(platform => {
      const row = (Array.isArray(rows) ? rows : []).find(item => item?.platform === platform);
      const sampledAt = integer(row?.sampledAt);
      return { platform, active: row?.active === true,
        watching: integer(row?.watching, MAX_COUNT),
        sampledAt: sampledAt !== null && sampledAt >= startedAt && sampledAt <= at ? sampledAt : null };
    });
    recordPeak(at);
  }
  function snapshot(at = cursor) {
    advance(at);
    return publicSimultaneousViewers({ schemaVersion: 1, scope: 'four-platforms', current: current(cursor),
      peak, peakAt, peakCounts, average: weightedAverage(weightedTotal, coveredMs),
      coveredMs, elapsedMs: cursor - startedAt, timeline: [...timeline.values()].map(({ weightedTotal: weighted, ...row }) =>
        ({ ...row, average: weightedAverage(weighted, row.coveredMs) })), timelineTruncated });
  }
  function seal(at = cursor) { advance(at); stopped = true; return snapshot(); }
  return { update, advance, snapshot, seal };
}

module.exports = { createSimultaneousViewers, publicSimultaneousViewers, FRESHNESS_MS, MAX_TIMELINE };
