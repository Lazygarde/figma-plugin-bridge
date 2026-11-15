// Smoke test without Figma: fakes the plugin UI over WebSocket and drives the bridge
// through HTTP (cli path) and MCP stdio (agent path).
//   1) node server.mjs        (in another terminal)
//   2) node smoke-test.mjs

import WebSocket from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const PORT = process.env.PORT || '3055';
const BASE = `http://127.0.0.1:${PORT}`;

// --- fake plugin ---
const ws = new WebSocket(`ws://127.0.0.1:${PORT}/plugin`);
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  const reply = { type: 'result', reqId: m.reqId, ok: true };
  if (m.cmd === 'ping') reply.data = { fileName: 'FAKE', page: 'Page 1', selectionCount: 1 };
  else if (m.cmd === 'get_node') reply.data = { document: { id: m.args.id ?? '1:1', type: 'FRAME', name: 'Login' }, variables: { 'VariableID:x/1:1': { name: 'spacing/md' } } };
  else if (m.cmd === 'export_image') { reply.data = { id: m.args.id ?? '1:1', name: 'Login', format: 'PNG', scale: m.args.scale ?? 2 }; reply.base64 = PNG_1x1; reply.mime = 'image/png'; }
  else if (m.cmd === 'export_image_fills') {
    reply.data = { images: [{ imageRef: 'abc', fileName: 'fill_abc.png', width: 1, height: 1 }] };
    reply.files = [{ name: 'fill_abc.png', mime: 'image/png', base64: PNG_1x1 }];
  }
  else { reply.ok = false; reply.error = 'Unknown command: ' + m.cmd; }
  ws.send(JSON.stringify(reply));
});

const assert = (c, msg) => { if (!c) { console.error('FAIL:', msg); process.exit(1); } console.log('ok  -', msg); };

// --- HTTP path ---
const http = async (cmd, args) => (await fetch(`${BASE}/call`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bridge': '1' }, body: JSON.stringify({ cmd, args }),
})).json();

assert((await http('ping', {})).result.fileName === 'FAKE', 'HTTP ping reaches plugin');
const img = await http('export_image', { id: '5:6', scale: 3 });
assert(img.ok && img.result.file.endsWith('5_6@3x.png') && img.result.bytes > 0, 'export_image saved file: ' + img.result.file);
const fills = await http('export_image_fills', { id: '5:6' });
assert(fills.ok && fills.result.images[0].file?.endsWith('fills/fill_abc.png') && fills.result.files[0].bytes > 0, 'export_image_fills saved: ' + fills.result.images[0].file);
assert((await http('nope', {})).ok === false, 'unknown command returns error');
const noHdr = await fetch(`${BASE}/call`, { method: 'POST', body: '{"cmd":"ping"}' });
assert(noHdr.status === 403, 'request without x-bridge header is rejected');

// --- MCP path ---
const client = new Client({ name: 'smoke', version: '0' });
await client.connect(new StdioClientTransport({ command: 'node', args: [path.join(dir, 'mcp.mjs')], env: { ...process.env, BRIDGE_URL: BASE } }));
const tools = (await client.listTools()).tools.map((t) => t.name);
assert(['figma_get_node', 'figma_resolve_variables', 'figma_list_image_fills', 'figma_export_image_fills'].every((t) => tools.includes(t)) && tools.length === 11, 'MCP lists tools: ' + tools.join(', '));
const r = await client.callTool({ name: 'figma_get_node', arguments: { id: '9:9' } });
assert(JSON.parse(r.content[0].text).document.id === '9:9', 'MCP figma_get_node round-trip');

await client.close();
ws.close();
console.log('ALL PASSED');
process.exit(0);

