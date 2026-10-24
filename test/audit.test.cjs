'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { root, readManifest, inspectBytes, auditSource } = require('../scripts/audit-source.cjs');
const { pack, readArchive, auditArchive } = require('../scripts/archive.cjs');
function temporary(t) { const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-core-audit-')); t.after(() => {
  const resolved = fs.realpathSync(folder); if (path.dirname(resolved) !== fs.realpathSync(os.tmpdir()) || !path.basename(resolved).startsWith('assistant-core-audit-')) throw new Error('Unsafe cleanup');
  fs.rmSync(resolved, { recursive: true, force: true });
}); return folder; }
test('source allowlist is complete and runtime contains no private import fallback', () => {
  const report = auditSource(); assert.deepEqual(report.findings, []); assert.equal(report.files.length, readManifest(root).length);
});
test('audit detects Unicode-escaped credentials, binary payload and forbidden imports', () => {
  const token = 'gh' + 'p_' + 'a'.repeat(36);
  assert.ok(inspectBytes('test.cjs', Buffer.from(token)).includes('credential-or-user-path'));
  assert.ok(inspectBytes('test.cjs', Buffer.from([...token].map(char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')).join(''))).includes('credential-or-user-path'));
  assert.ok(inspectBytes('test.cjs', Buffer.from([0, 1, 2])).includes('binary-payload'));
  assert.ok(inspectBytes('core/example.cjs', Buffer.from("require('../host.cjs')")).includes('nonportable-runtime-import'));
  assert.ok(inspectBytes('test.cjs', Buffer.from('A'.repeat(401))).includes('opaque-encoded-payload'));
});
test('unlisted or missing files fail closed', t => {
  const folder = temporary(t); fs.writeFileSync(path.join(folder, 'source-files.json'), JSON.stringify({ schemaVersion: 1, files: ['source-files.json','required.cjs'] }));
  fs.writeFileSync(path.join(folder, 'extra.txt'), 'fixture'); const report = auditSource(folder);
  assert.ok(report.findings.some(row => row.reason === 'missing')); assert.ok(report.findings.some(row => row.reason === 'outside-allowlist'));
});
test('actual source archive bytes match allowlist and tampering fails', t => {
  const folder = temporary(t), file = path.join(folder, 'source.tar');
  assert.equal(pack(file).state, 'passed'); const entries = readArchive(file);
  assert.equal(entries.length, readManifest(root).length);
  assert.equal(auditArchive(file).state, 'passed');
  const bytes = fs.readFileSync(file), needle = Buffer.from('Content-free livestream assistant runtime');
  const offset = bytes.indexOf(needle); assert.ok(offset >= 0); bytes[offset] = 88; fs.writeFileSync(file, bytes);
  assert.throws(() => auditArchive(file), /differs/);
});
