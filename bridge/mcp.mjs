// MCP stdio server. Exposes the Figma plugin commands as tools for an AI agent.
// It is a thin proxy: every tool call is forwarded to server.mjs (must be running).

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BRIDGE = process.env.BRIDGE_URL || 'http://127.0.0.1:3055';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bridgeUp() {
  try {
    return (await fetch(`${BRIDGE}/status`)).ok;
  } catch {
    return false;
  }
}

/** Start server.mjs in the background if nothing answers on the bridge URL (local URLs only). */
async function ensureBridge() {
  if (await bridgeUp()) return true;
  const u = new URL(BRIDGE);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname)) return false;
  const child = spawn(process.execPath, [path.join(HERE, 'server.mjs')], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PORT: u.port || '3055' },
  });
  child.unref();
  for (let i = 0; i < 30; i++) {
    await sleep(150);
    if (await bridgeUp()) return true;
  }
  return false;
}

async function call(cmd, args = {}) {
  if (!(await ensureBridge())) {
    return { isError: true, content: [{ type: 'text', text: `Bridge not reachable at ${BRIDGE} and could not be started. Start it with: node bridge/server.mjs` }] };
  }
  let r;
  try {
    r = await fetch(`${BRIDGE}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge': '1' },
      body: JSON.stringify({ cmd, args }),
    });
  } catch {
    return { isError: true, content: [{ type: 'text', text: `Bridge not reachable at ${BRIDGE}.` }] };
  }
  const j = await r.json();
  if (!j.ok) return { isError: true, content: [{ type: 'text', text: j.error }] };
  return { content: [{ type: 'text', text: JSON.stringify(j.result) }] };
}

const server = new McpServer({ name: 'figma-live-bridge', version: '0.1.0' });

const idArg = z.string().optional().describe('Node id like "12:34". Omit to use the first selected node in Figma.');

server.registerTool('figma_ping', {
  description: 'Check the Figma plugin connection. Returns file name, current page and selection count.',
  inputSchema: {},
}, () => call('ping'));

server.registerTool('figma_get_selection', {
  description: 'List the nodes currently selected in Figma (id, name, type, size).',
  inputSchema: {},
}, () => call('get_selection'));

server.registerTool('figma_get_pages', {
  description: 'List pages of the open Figma file.',
  inputSchema: {},
}, () => call('get_pages'));

server.registerTool('figma_get_metadata', {
  description: 'Thin layer tree (id, name, type, bounds, childCount). Cheap; use it to browse before get_node. Defaults to the selection, or the current page when nothing is selected.',
  inputSchema: { id: idArg, depth: z.number().int().min(0).max(8).optional().describe('Child levels to include (default 2)') },
}, (a) => call('get_metadata', a));

server.registerTool('figma_get_node', {
  description: 'Full design properties of a node as REST-compatible JSON: fills, strokes, effects (drop shadows), text style, auto layout, constraints. By default every bound variable is resolved: each VARIABLE_ALIAS gets a `name` (token name) and a top-level `variables` map gives collection, type, per-mode values and Android codeSyntax. Image fills only carry an `imageRef`; use figma_export_image_fills to get the actual files. Large; limit with depth.',
  inputSchema: {
    id: idArg,
    depth: z.number().int().min(0).max(20).optional().describe('Child levels to include (default 10)'),
    resolveVariables: z.boolean().optional().describe('Resolve VariableIDs to token names (default true)'),
  },
}, (a) => call('get_node', a));

server.registerTool('figma_resolve_variables', {
  description: 'Resolve VariableIDs (e.g. from boundVariables) to token name, collection, type, per-mode values and Android codeSyntax. Colors are returned as hex; aliases as { alias: "token/name" }.',
  inputSchema: { ids: z.array(z.string()).min(1).describe('VariableIDs like "VariableID:abc/123:4"') },
}, (a) => call('resolve_variables', a));

server.registerTool('figma_list_image_fills', {
  description: 'List image fills/strokes (imageRef) under a node, with original image size and, per use: node id/name, visibility, opacity, blendMode, scaleMode and imageTransform (needed to reproduce crop/flip/rotation). Use before figma_export_image_fills.',
  inputSchema: { id: idArg },
}, (a) => call('list_image_fills', a));

server.registerTool('figma_export_image_fills', {
  description: 'Download the original image files behind image fills (e.g. decorative patterns, photos) and save them to disk. Pass `imageRef` for one image, or `id` (or nothing = selection) to export every image under that node. Returns absolute file paths plus usage info per image. Files are the raw originals, without the Figma crop/transform/blend.',
  inputSchema: {
    id: idArg,
    imageRef: z.string().optional().describe('Specific imageRef (from get_node or list_image_fills). Overrides id.'),
  },
}, (a) => call('export_image_fills', a));

server.registerTool('figma_export_image', {
  description: 'Render a node to an image file on disk and return its absolute path. Use it as the visual reference for comparing generated UI.',
  inputSchema: {
    id: idArg,
    format: z.enum(['PNG', 'JPG', 'SVG']).optional().describe('Default PNG'),
    scale: z.number().min(0.5).max(4).optional().describe('Default 2'),
  },
}, (a) => call('export_image', a));

server.registerTool('figma_get_variables', {
  description: 'Local variable collections (color/spacing/typography tokens) with values per mode.',
  inputSchema: {},
}, () => call('get_variables'));

server.registerTool('figma_get_styles', {
  description: 'Local paint, text and effect (shadow) styles.',
  inputSchema: {},
}, () => call('get_styles'));

await server.connect(new StdioServerTransport());

