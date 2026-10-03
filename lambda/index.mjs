import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BUNDLE_BYTES = 20 * 1024 * 1024;
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;
const ROUTE = /^\/t\/([^/]+)\/(mcp|push)$/;

const sdk = import('@aws-sdk/client-s3').catch(() => null);
let s3;
async function client() {
  const { S3Client } = await sdk;
  return (s3 ??= new S3Client({}));
}
const s3Store = {
  async get(key) {
    const { GetObjectCommand } = await sdk;
    try {
      const res = await (await client()).send(new GetObjectCommand({ Bucket: process.env.BUCKET, Key: key }));
      return await res.Body.transformToString();
    } catch (err) {
      if (err.name === 'NoSuchKey') return null;
      throw err;
    }
  },
  async put(key, body) {
    const { PutObjectCommand } = await sdk;
    await (await client()).send(new PutObjectCommand({ Bucket: process.env.BUCKET, Key: key, Body: body, ContentType: 'application/json' }));
  },
};

const bundleKey = (token) => `tenants/${createHash('sha256').update(token).digest('hex')}/bundle.json`;

const json = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export async function handler(event) {
  return handle(event, s3Store);
}

export async function handle(event, store) {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';

  if (path === '/' && method === 'GET') {
    return { statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: LANDING };
  }

  const match = ROUTE.exec(path);
  if (!match || !TOKEN.test(match[1])) return json(404, { error: 'not found' });
  if (method !== 'POST') return { statusCode: 405, headers: { allow: 'POST' }, body: '' };

  const [, token, route] = match;
  let raw = event.body ?? '';
  try {
    let buf = Buffer.from(raw, event.isBase64Encoded ? 'base64' : 'utf8');
    if ((event.headers?.['content-encoding'] ?? '') === 'gzip') buf = gunzipSync(buf, { maxOutputLength: MAX_BUNDLE_BYTES });
    raw = buf.toString('utf8');
  } catch {
    return json(413, { error: `bundle must be valid gzip under ${MAX_BUNDLE_BYTES} bytes` });
  }

  if (route === 'push') {
    const bundle = parseBundle(raw);
    if (!bundle) return json(400, { error: 'body must be {"skills": {name: {description, files: {path: text}}}}' });
    await store.put(bundleKey(token), JSON.stringify({ pushedAt: new Date().toISOString(), skills: bundle.skills }));
    return json(200, { ok: true, skills: Object.keys(bundle.skills).length });
  }

  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return json(400, rpcError(null, -32700, 'parse error'));
  }
  if (Array.isArray(message)) return json(400, rpcError(null, -32600, 'batches are not supported'));
  if (message.id === undefined) return { statusCode: 202, body: '' };

  console.log(JSON.stringify({ rpc: message.method, tool: message.params?.name }));
  const stored = await store.get(bundleKey(token));
  const skills = stored ? JSON.parse(stored).skills : {};
  return json(200, rpc(message, skills));
}

function parseBundle(raw) {
  let bundle;
  try {
    bundle = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!bundle || typeof bundle.skills !== 'object') return null;
  for (const skill of Object.values(bundle.skills)) {
    if (typeof skill?.description !== 'string' || typeof skill.files?.['SKILL.md'] !== 'string') return null;
    if (Object.values(skill.files).some((text) => typeof text !== 'string')) return null;
  }
  return bundle;
}

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError });

export function rpc({ id, method, params = {} }, skills) {
  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {}, prompts: {} },
        serverInfo: { name: 'skill-relay', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      });
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: tools(skills) });
    case 'tools/call':
      return rpcResult(id, callTool(params.name, params.arguments ?? {}, skills));
    case 'prompts/list':
      return rpcResult(id, {
        prompts: Object.entries(skills).map(([name, s]) => ({ name, description: s.description })),
      });
    case 'prompts/get': {
      const skill = skills[params.name];
      if (!skill) return rpcError(id, -32602, `unknown skill: ${params.name}`);
      return rpcResult(id, {
        description: skill.description,
        messages: [{ role: 'user', content: { type: 'text', text: skillText(params.name, skill) } }],
      });
    }
    default:
      return rpcError(id, -32601, `method not found: ${method}`);
  }
}

const INSTRUCTIONS =
  'Skill Relay serves the user\'s Agent Skills. Each skill is a tool named after it. When a task matches a skill, call that ' +
  'tool before doing anything else and follow the playbook it returns; call read_skill_file for any file the playbook references.';

const READ_FILE = 'read_skill_file';
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;

function tools(skills) {
  const perSkill = Object.entries(skills)
    .filter(([name]) => TOOL_NAME.test(name) && name !== READ_FILE)
    .map(([name, s]) => ({
      name,
      description: `${s.description}\n\nCall this tool first for this kind of task. It returns the user's expert playbook (SKILL.md); follow it.`,
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: `Skill: ${name}`, readOnlyHint: true },
    }));
  return [
    ...perSkill,
    {
      name: READ_FILE,
      description: 'Read a reference, script, or template file bundled with a skill, by a path the skill listed.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Skill name' }, path: { type: 'string', description: 'e.g. references/style.md' } },
        required: ['name', 'path'],
      },
      annotations: { readOnlyHint: true },
    },
  ];
}

function skillText(name, skill) {
  const others = Object.keys(skill.files).filter((p) => p !== 'SKILL.md');
  const listing = others.length ? `\n\n---\nFiles in this skill (read with ${READ_FILE}):\n${others.map((p) => `- ${p}`).join('\n')}` : '';
  return `# Skill: ${name}\n\n${skill.files['SKILL.md']}${listing}`;
}

function callTool(tool, args, skills) {
  if (tool === READ_FILE) {
    const skill = skills[args.name];
    if (!skill) return text(`No skill named "${args.name}".`, true);
    const file = skill.files[args.path];
    return file === undefined ? text(`No file "${args.path}" in ${args.name}. Files: ${Object.keys(skill.files).join(', ')}`, true) : text(file);
  }
  const skill = skills[tool];
  return skill ? text(skillText(tool, skill)) : text(`No skill named "${tool}". Push your skills from the Skill Relay page.`, true);
}

const LANDING = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Skill Relay</title>
<style>
body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:680px;margin:64px auto;padding:0 20px;color:#111;background:#fff}
h1{font-size:32px;margin:0 0 8px}p.lede{font-size:19px;color:#333;margin:0 0 32px}
pre{background:#f4f4f5;padding:14px 16px;border-radius:8px;overflow-x:auto;font-size:14px}
h2{font-size:18px;margin:36px 0 8px}a{color:#512d8b}footer{margin-top:48px;color:#666;font-size:14px}
</style></head><body>
<h1>Skill Relay</h1>
<p class="lede">Your Claude Code skills live in a folder on one laptop. Skill Relay puts them in every Claude you use: claude.ai on the web, the desktop app, and your phone.</p>
<h2>1. Push your skills</h2>
<pre>git clone https://github.com/ricardodreyes/skill-relay
node skill-relay/bin/push.mjs</pre>
<p>It reads <code>~/.claude/skills</code>, refuses to upload anything that looks like a secret, and prints your private connector URL.</p>
<h2>2. Add the connector</h2>
<p>In claude.ai open Settings, Connectors, Add custom connector, and paste the URL. Your skills now show up as tools. Claude loads one when your task matches it, the same way Claude Code does.</p>
<h2>3. Push again whenever you edit a skill</h2>
<p>Every push replaces the last one. Nothing else to sync.</p>
<footer>Runs on AWS Lambda and S3. Source: <a href="https://github.com/ricardodreyes/skill-relay">github.com/ricardodreyes/skill-relay</a></footer>
</body></html>`;
