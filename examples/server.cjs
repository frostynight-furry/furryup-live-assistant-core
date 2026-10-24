'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { createSimulation } = require('./scenarios.cjs');
function createDemoServer() {
  const simulation = createSimulation(), token = randomBytes(24).toString('hex');
  const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
  const server = http.createServer(async (req, res) => {
    const address = server.address(), origin = `http://127.0.0.1:${address.port}`;
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    if (req.headers.host !== `127.0.0.1:${address.port}` || req.headers.origin && req.headers.origin !== origin) { res.writeHead(403); res.end(); return; }
    const send = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    if (req.method === 'GET' && files[req.url]) {
      const [name, type] = files[req.url]; res.setHeader('Content-Type', type + '; charset=utf-8'); res.end(fs.readFileSync(path.join(__dirname, 'web', name))); return;
    }
    if (req.method === 'GET' && req.url === '/state') { send({ token, ...simulation.snapshot() }); return; }
    if (req.method === 'POST' && req.url?.startsWith('/action/')) {
      if (req.headers['x-demo-token'] !== token) { res.writeHead(403); res.end(); return; }
      req.resume();
      try { send(await simulation.action(req.url.slice('/action/'.length))); } catch { res.writeHead(400); res.end('Invalid action'); } return;
    }
    res.writeHead(404); res.end();
  });
  server.on('close', () => simulation.dispose()); return server;
}
if (require.main === module) { const server = createDemoServer(); server.listen(0, '127.0.0.1', () => console.log(`Synthetic simulator: http://127.0.0.1:${server.address().port}`)); }
module.exports = { createDemoServer };
