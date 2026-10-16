import process from 'node:process';
import readline from 'node:readline';
const mode = process.argv[2] ?? 'normal';
const lines = readline.createInterface({ input: process.stdin });
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
const echo = { name: 'Echo.Text', description: 'Echo a message', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }, annotations: { readOnlyHint: true } };
let changed = false;
lines.on('line', (line) => {
  const message = JSON.parse(line);
  const { id, method, params } = message;
  if (method === 'initialize') {
    if (mode === 'hang-init') return;
    if (mode === 'bad-json') { process.stdout.write('not json\n'); return; }
    if (mode === 'oversized') { process.stdout.write('x'.repeat(1024 * 1024 + 1)); return; }
    if (mode === 'crash-init') { process.exit(3); }
    reply(id, { protocolVersion: params.protocolVersion, capabilities: mode === 'no-tools' ? {} : { tools: { listChanged: true } }, serverInfo: { name: 'fixture', version: '1' } });
    return;
  }
  if (method === 'tools/list') {
    if (mode === 'hang-list') return;
    if (mode === 'cursor-loop') { reply(id, { tools: [], nextCursor: 'same' }); return; }
    if (mode === 'duplicates') { reply(id, { tools: [echo, echo] }); return; }
    if (mode === 'pagination' && !params?.cursor) { reply(id, { tools: [echo], nextCursor: 'second' }); return; }
    reply(id, { tools: mode === 'pagination' ? [{ ...echo, name: 'Second' }] : [{ ...echo, description: changed ? 'Updated echo' : echo.description }] });
    return;
  }
  if (method === 'tools/call') {
    if (params.name === 'crash') { process.exit(7); }
    if (params.name === 'hang') return;
    if (params.name === 'rpc_error') { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32603, message: 'sensitive server internals' } }) + '\n'); return; }
    if (params.name === 'tool_error') { reply(id, { content: [{ type: 'text', text: 'Requested item missing' }], isError: true }); return; }
    if (params.name === 'invalid_result') { reply(id, { content: 'bad' }); return; }
    if (params.name === 'change') { changed = true; process.stdout.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }) + '\n'); }
    if (params.name === 'env') { reply(id, { content: [{ type: 'text', text: JSON.stringify({ forwarded: process.env.TEST_MCP_VALUE, ambient: process.env.SNIPVIA_TEST_SECRET }) }] }); return; }
    reply(id, { content: [{ type: 'text', text: params.arguments?.text ?? 'ok' }] });
  }
});
lines.on('close', () => process.exit(0));
