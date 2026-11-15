// Bridge server: HTTP (for MCP/CLI/curl) + WebSocket (for the Figma plugin).
//
//   agent --MCP--> mcp.mjs --HTTP POST /call--> server.mjs --WS--> plugin UI --> figma.*
//
// Bound to 127.0.0.1 only. Run:  node server.mjs   (PORT env to change, default 3055)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 3055);
const HOST = '127.0.0.1';
const CALL_TIMEOUT_MS = Number(process.env.CALL_TIMEOUT_MS || 60_000);
const OUT_DIR = process.env.OUT_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'out');

/** @type {import('ws').WebSocket | null} */
let plugin = null;
/** @type {Map<string, {resolve: (v: any) => void, reject: (e: Error) => void, timer: NodeJS.Timeout}>} */
const pending = new Map();

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- WebSocket (plugin side) ----------

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 * 1024 });

wss.on('connection', (ws) => {
  if (plugin && plugin.readyState === 1) plugin.close(1000, 'replaced by a newer plugin instance');
  plugin = ws;
  log('plugin connected');

  ws.on('message', (raw) => {
    let m;
    try {
      m = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (m.type !== 'result') return;
    const p = pending.get(m.reqId);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(m.reqId);
    p.resolve(m);
  });

  ws.on('close', () => {
    if (plugin === ws) plugin = null;
    log('plugin disconnected');
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Plugin disconnected before replying'));
      pending.delete(id);
    }
  });
});

/** Send a command to the plugin and wait for its reply. */
function callPlugin(cmd, args = {}) {
  return new Promise((resolve, reject) => {
    if (!plugin || plugin.readyState !== 1) {
      reject(new Error('Figma plugin is not connected. Open Figma Desktop > Plugins > Development > "Design Live Bridge".'));
      return;
    }
    const reqId = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(reqId);
      reject(new Error(`Timeout after ${CALL_TIMEOUT_MS}ms waiting for plugin (${cmd})`));
    }, CALL_TIMEOUT_MS);
    pending.set(reqId, { resolve, reject, timer });
    plugin.send(JSON.stringify({ type: 'command', reqId, cmd, args }));
  });
}

/** Turn a plugin reply into a JSON-friendly result; image bytes are saved to disk instead of returned inline. */
function finalize(cmd, reply) {
  if (!reply.ok) throw new Error(reply.error || 'Plugin error');

  // Several files (image fills): written to <OUT_DIR>/fills/, paths returned next to the plugin data.
  if (Array.isArray(reply.files)) {
    const dir = path.resolve(OUT_DIR, 'fills');
    fs.mkdirSync(dir, { recursive: true });
    const files = reply.files.map((f) => {
      const safe = String(f.name).replace(/[^\w.-]+/g, '_');
      const file = path.join(dir, safe);
      const buf = Buffer.from(f.base64, 'base64');
      fs.writeFileSync(file, buf);
      return { name: f.name, file, bytes: buf.length, mime: f.mime };
    });
    const byName = new Map(files.map((f) => [f.name, f.file]));
    const images = (reply.data?.images ?? []).map((im) => (im.fileName ? { ...im, file: byName.get(im.fileName) } : im));
    return { ...reply.data, images, files };
  }

  if (reply.base64) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg' }[reply.mime] || 'bin';
    const safeId = String(reply.data?.id ?? 'node').replace(/[^\w.-]+/g, '_');
    const file = path.resolve(OUT_DIR, `${safeId}@${reply.data?.scale ?? 1}x.${ext}`);
    const buf = Buffer.from(reply.base64, 'base64');
    fs.writeFileSync(file, buf);
    return { ...reply.data, file, bytes: buf.length };
  }
  return reply.data;
}

// ---------- HTTP (agent side) ----------

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (req.method === 'GET' && req.url === '/status') {
    return send(200, { pluginConnected: !!plugin && plugin.readyState === 1, pending: pending.size, outDir: path.resolve(OUT_DIR) });
  }

  if (req.method === 'POST' && req.url === '/call') {
    // Custom header forces a CORS preflight, which we never approve: blocks random web pages
    // from driving the bridge via fetch() to localhost.
    if (req.headers['x-bridge'] !== '1') return send(403, { ok: false, error: 'missing x-bridge header' });
    try {
      const { cmd, args } = JSON.parse((await readBody(req)) || '{}');
      if (typeof cmd !== 'string') return send(400, { ok: false, error: 'cmd is required' });
      log('call', cmd, JSON.stringify(args ?? {}));
      const reply = await callPlugin(cmd, args ?? {});
      return send(200, { ok: true, result: finalize(cmd, reply) });
    } catch (e) {
      return send(200, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  send(404, { ok: false, error: 'not found' });
});

server.on('upgrade', (req, socket, head) => {
  // Plugin iframe has origin "null"; reject real web origins (cross-site WebSocket hijacking).
  const origin = req.headers.origin;
  if (req.url !== '/plugin' || (origin && origin.startsWith('http'))) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

server.listen(PORT, HOST, () => {
  log(`bridge listening on http://${HOST}:${PORT}  (ws path /plugin)`);
  log('waiting for the Figma plugin to connect...');
});

