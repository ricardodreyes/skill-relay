#!/usr/bin/env node
// Usage: node bin/push.mjs [--dir ~/.claude/skills] [--only names.json] [--relay URL]
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

const { values: opts } = parseArgs({
  options: {
    dir: { type: 'string', default: join(homedir(), '.claude', 'skills') },
    only: { type: 'string' },
    relay: { type: 'string', default: 'https://o36lbkqwq54bltwrbozuqluxru0unmqg.lambda-url.us-east-1.on.aws' },
  },
});

const MAX_FILE_BYTES = 200 * 1024;
const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv']);
const SECRETS = [
  /AKIA[0-9A-Z]{16}/,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/,
  /\bsk_live_[A-Za-z0-9]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{36}/,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

const configDir = join(homedir(), '.skill-relay');
const tokenFile = join(configDir, 'token');
if (!existsSync(tokenFile)) {
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  writeFileSync(tokenFile, randomBytes(32).toString('base64url'), { mode: 0o600 });
}
const token = readFileSync(tokenFile, 'utf8').trim();

if (!existsSync(opts.dir)) {
  console.error(`No skills folder at ${opts.dir}. Pass --dir to point at yours.`);
  process.exit(1);
}

const only = opts.only ? new Set(JSON.parse(readFileSync(opts.only, 'utf8'))) : null;
const ignoreFile = join(opts.dir, '.relayignore');
const ignored = new Set(existsSync(ignoreFile) ? readFileSync(ignoreFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean) : []);

function description(skillMd) {
  const front = /^---\n([\s\S]*?)\n---/.exec(skillMd)?.[1] ?? '';
  const lines = front.split('\n');
  const i = lines.findIndex((l) => /^description:/.test(l));
  if (i < 0) return '';
  let value = lines[i].replace(/^description:\s*/, '');
  if (/^[>|][-+]?$/.test(value) || value === '') {
    const rest = [];
    for (const l of lines.slice(i + 1)) {
      if (!/^\s/.test(l)) break;
      rest.push(l.trim());
    }
    value = rest.join(' ');
  }
  return value.replace(/^["']|["']$/g, '').trim();
}

function walk(root, dir, files, skipped) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry === '.DS_Store') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(root, full, files, skipped);
      continue;
    }
    const rel = relative(root, full);
    if (st.size > MAX_FILE_BYTES) {
      skipped.push(`${rel} (over 200 KB)`);
      continue;
    }
    const buf = readFileSync(full);
    if (buf.includes(0)) {
      skipped.push(`${rel} (binary)`);
      continue;
    }
    files[rel] = buf.toString('utf8');
  }
}

const skills = {};
const leaks = [];
for (const name of readdirSync(opts.dir).sort()) {
  if (ignored.has(name) || (only && !only.has(name))) continue;
  const dir = join(opts.dir, name);
  if (!existsSync(join(dir, 'SKILL.md'))) continue;
  const files = {};
  const skipped = [];
  walk(dir, dir, files, skipped);
  for (const [path, text] of Object.entries(files)) {
    if (SECRETS.some((re) => re.test(text))) leaks.push(`${name}/${path}`);
  }
  skills[name] = { description: description(files['SKILL.md']), files };
}

if (leaks.length) {
  console.error(`Refusing to push. These files look like they contain a secret:\n${leaks.map((l) => `  ${l}`).join('\n')}`);
  console.error(`Fix them or add the skill name to ${ignoreFile}.`);
  process.exit(1);
}

const body = gzipSync(JSON.stringify({ skills }));
const res = await fetch(`${opts.relay}/t/${token}/push`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
  body,
});
if (!res.ok) {
  console.error(`Push failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const { skills: count } = await res.json();
const size = body.length < 1024 ? `${body.length} bytes` : `${Math.round(body.length / 1024)} KB`;
console.log(`Pushed ${count} ${count === 1 ? 'skill' : 'skills'} (${size} gzipped).`);
console.log(`\nConnector URL (keep it private, it is the only key):\n${opts.relay}/t/${token}/mcp`);
