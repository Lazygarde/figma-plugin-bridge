#!/usr/bin/env node
// Tiny CLI to test the bridge without an MCP client.
//   node cli.mjs status
//   node cli.mjs ping
//   node cli.mjs get_metadata '{"depth":3}'
//   node cli.mjs get_node '{"id":"12:34","depth":4}'
//   node cli.mjs export_image '{"id":"12:34","scale":2}'

const BRIDGE = process.env.BRIDGE_URL || 'http://127.0.0.1:3055';
const [cmd, argsJson] = process.argv.slice(2);

if (!cmd) {
  console.error('usage: node cli.mjs <status|ping|get_selection|get_pages|get_metadata|get_node|export_image|get_variables|get_styles> [jsonArgs]');
  process.exit(1);
}

try {
  if (cmd === 'status') {
    console.log(JSON.stringify(await (await fetch(`${BRIDGE}/status`)).json(), null, 2));
  } else {
    const r = await fetch(`${BRIDGE}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge': '1' },
      body: JSON.stringify({ cmd, args: argsJson ? JSON.parse(argsJson) : {} }),
    });
    const j = await r.json();
    if (!j.ok) {
      console.error('ERROR:', j.error);
      process.exit(2);
    }
    console.log(JSON.stringify(j.result, null, 2));
  }
} catch (e) {
  console.error('Bridge not reachable at', BRIDGE, '-', e.message, '\nStart it with: node bridge/server.mjs');
  process.exit(3);
}

