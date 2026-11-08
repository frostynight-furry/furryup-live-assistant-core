'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSimultaneousViewers, publicSimultaneousViewers, createViewerPresence } = require('../core/index.cjs');

test('simultaneous viewers computes time-weighted complete coverage average and peak', () => {
  const start = 60_000;
  const tracker = createSimultaneousViewers({ startedAt: start });
  const platforms = ['bilibili', 'douyin', 'kuaishou', 'wechat_channels'];
  tracker.update(start, platforms.map((platform, idx) => ({
    platform,
    active: true,
    watching: (idx + 1) * 10,
    sampledAt: start
  })));
  tracker.advance(start + 30_000);
  const snap = tracker.snapshot(start + 30_000);
  assert.equal(snap.current.complete, true);
  assert.equal(snap.current.total, 100);
  assert.equal(snap.peak, 100);
  assert.equal(snap.average, 100);
  assert.equal(snap.coveredMs, 30_000);
  assert.deepEqual(publicSimultaneousViewers(snap), snap);
});

test('viewer presence tracks online-list dwell using monotonic clock and resets on discontinuity', () => {
  let wall = 100_000, mono = 10_000;
  const presence = createViewerPresence({
    now: () => wall,
    monotonicNow: () => mono
  });
  presence.configure({
    enabled: true,
    platforms: {
      bilibili: { userLevel: 20, wealthLevel: null },
      douyin: { userLevel: null, wealthLevel: null },
      kuaishou: { userLevel: null, wealthLevel: null },
      wechat_channels: { userLevel: null, wealthLevel: null }
    }
  });
  for (let step = 0; step <= 3; step++) {
    wall = 100_000 + step * 20_000;
    mono = 10_000 + step * 20_000;
    assert.equal(presence.observe({
      platform: 'bilibili',
      roomId: 'room-1',
      observedAt: wall,
      status: 'live',
      source: 'bilibili-online-gold-rank',
      presenceEvidence: 'online-list',
      complete: true,
      viewers: [{ userId: 'u-100', userName: '老观众', online: true, userLevel: 25, wealthLevel: null }]
    }), true);
  }
  const list = presence.candidates();
  assert.equal(list.length, 1);
  assert.equal(list[0].userName, '老观众');
  assert.ok(list[0].elapsedSeconds >= 60);
  assert.equal(presence.consume(list[0].id), true);
  assert.equal(presence.candidates().length, 0);
});
