import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { handle } from './index.mjs';

const objects = new Map();
const store = { get: async (k) => objects.get(k) ?? null, put: async (k, v) => void objects.set(k, v) };
const token = 'a'.repeat(43);
const post = (route, body, extra = {}) =>
  handle({ rawPath: `/t/${token}/${route}`, requestContext: { http: { method: 'POST' } }, body, ...extra }, store);
const rpc = async (method, params) => JSON.parse((await post('mcp', JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }))).body);

const bundle = {
  skills: {
    'seo-audit': { description: 'Audit a page for SEO problems.', files: { 'SKILL.md': '# SEO audit\nDo the thing.', 'references/checks.md': 'checklist' } },
  },
};

assert.equal((await handle({ rawPath: '/', requestContext: { http: { method: 'GET' } } }, store)).statusCode, 200, 'landing page');
assert.equal((await handle({ rawPath: '/t/short/mcp', requestContext: { http: { method: 'POST' } } }, store)).statusCode, 404, 'bad token rejected');
assert.equal((await handle({ rawPath: `/t/${token}/mcp`, requestContext: { http: { method: 'GET' } } }, store)).statusCode, 405, 'GET on mcp is 405');

assert.match((await rpc('tools/list')).result.tools[0].description, /no skills pushed yet/, 'empty tenant explains itself');

const gz = gzipSync(JSON.stringify(bundle)).toString('base64');
const pushed = await post('push', gz, { isBase64Encoded: true, headers: { 'content-encoding': 'gzip' } });
assert.equal(pushed.statusCode, 200, pushed.body);
assert.equal(JSON.parse(pushed.body).skills, 1);
assert.ok(![...objects.keys()][0].includes(token), 'token never stored in the key');
assert.equal((await post('push', JSON.stringify({ skills: { x: { description: 1 } } }))).statusCode, 400, 'bad bundle rejected');

const init = await rpc('initialize', { protocolVersion: '2025-06-18' });
assert.equal(init.result.protocolVersion, '2025-06-18');
assert.equal((await rpc('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-06-18', 'unknown version falls back');

const list = await rpc('tools/list');
assert.deepEqual(list.result.tools.map((t) => t.name), ['load_skill', 'read_skill_file', 'search_skills']);
assert.match(list.result.tools[0].description, /- seo-audit: Audit a page/, 'catalog in load_skill description');

const loaded = await rpc('tools/call', { name: 'load_skill', arguments: { name: 'seo-audit' } });
assert.match(loaded.result.content[0].text, /Do the thing[\s\S]*references\/checks\.md/, 'SKILL.md plus file listing');
assert.equal((await rpc('tools/call', { name: 'load_skill', arguments: { name: 'nope' } })).result.isError, true);
assert.equal((await rpc('tools/call', { name: 'read_skill_file', arguments: { name: 'seo-audit', path: 'references/checks.md' } })).result.content[0].text, 'checklist');
assert.match((await rpc('tools/call', { name: 'search_skills', arguments: { query: 'seo' } })).result.content[0].text, /seo-audit/);
assert.equal((await rpc('prompts/list')).result.prompts[0].name, 'seo-audit');
assert.match((await rpc('prompts/get', { name: 'seo-audit' })).result.messages[0].content.text, /# SEO audit/);
assert.equal((await rpc('bogus')).error.code, -32601);
assert.equal((await post('mcp', JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }))).statusCode, 202, 'notification is 202');

console.log('all checks passed');
