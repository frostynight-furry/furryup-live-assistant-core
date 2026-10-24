'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { replay } = require('../examples/scenarios.cjs');
const { createDemoServer } = require('../examples/server.cjs');
test('replay exercises silent output, memory, pause, feedback, expiry and room reset', async () => {
  const report = await replay(); assert.equal(report.synthetic, true);
  const steps = report.transitions;
  assert.equal(steps[4].pending, 1); assert.equal(steps[4].displayed, null);
  assert.ok(steps[5].displayed); assert.deepEqual(steps[6].terminal, ['adopted']);
  assert.deepEqual(steps[8].terminal, ['adopted','expired']); assert.deepEqual(steps[9].terminal, []);
});
test('loopback demo serves only fixed files and requires a session token for mutations', async t => {
  const server = createDemoServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}`;
  const home = await fetch(url); assert.equal(home.status, 200); assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await home.text(), /SYNTHETIC/);
  assert.equal((await fetch(url + '/package.json')).status, 404);
  assert.equal((await fetch(url + '/action/event', { method: 'POST' })).status, 403);
  const state = await (await fetch(url + '/state')).json();
  const headers = { 'X-Demo-Token': state.token };
  assert.equal((await fetch(url + '/action/event', { method: 'POST', headers: { ...headers, Origin: 'http://example.invalid' } })).status, 403);
  assert.equal((await (await fetch(url + '/action/event', { method: 'POST', headers })).json()).eventCount, 1);
  assert.equal((await fetch(url + '/action/unknown', { method: 'POST', headers })).status, 400);
});
