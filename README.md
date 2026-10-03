# Skill Relay

Claude Code skills live in `~/.claude/skills` on one laptop. Claude on the web, the desktop app, and your phone can't see them. Skill Relay is a remote MCP server on AWS that serves your skill folder to any MCP client, so the playbooks you wrote for Claude Code work everywhere you talk to Claude.

Live: https://o36lbkqwq54bltwrbozuqluxru0unmqg.lambda-url.us-east-1.on.aws/

## Use it

```sh
git clone https://github.com/ricardodreyes/skill-relay
node skill-relay/bin/push.mjs
```

The push reads `~/.claude/skills`, refuses to upload any file that looks like a secret (AWS keys, Anthropic and OpenAI keys, GitHub and Slack tokens, private keys), and prints a private connector URL. In claude.ai open Settings, then Connectors, then Add custom connector, and paste it. Push again whenever you edit a skill; each push replaces the last.

Skip a skill by putting its folder name on a line in `~/.claude/skills/.relayignore`. Push only a list with `--only names.json`.

## How Claude picks a skill

Claude Code shows the model every skill's name and description, and the model loads one when the task matches. Skill Relay copies that by making each skill its own MCP tool. The tool's name is the skill's name (`seo-audit`, `copywriting`), and its description is the skill's description. When you ask claude.ai to "audit the SEO on my site", it finds `seo-audit` the same way it finds any other tool, calls it, and gets the SKILL.md back as its playbook.

One more tool, `read_skill_file(name, path)`, returns any reference, script, or template file a skill points to. Each skill is also an MCP prompt, so clients with a prompt picker can load one by hand.

The first version had a single `load_skill` tool with the whole catalog packed into its description. claude.ai connected fine but never called it: the model went straight to web fetch. Tool names are what the model matches on, so the catalog moved into the names.

One claude.ai detail: with many connectors on, claude.ai defaults to "Load tools when needed" and hides connector tools until the model searches for them. A plain "audit my SEO" can skip the search and go to web fetch. Saying "use my skills" (no skill name needed) makes it search, and it picks the right skill from there. Switching Tool access to "Tools already loaded" puts every skill in front of the model from the start.

## How it's built

```
push.mjs ──gzip POST──▶ Lambda Function URL ──▶ S3  tenants/<sha256(token)>/bundle.json
claude.ai ──JSON-RPC───▶ Lambda Function URL ──▶ S3  (read)
```

One Lambda function (`lambda/index.mjs`, Node 22, no npm dependencies) serves the landing page, the push endpoint, and a stateless MCP Streamable HTTP endpoint. Each user's skills are one JSON bundle in a private S3 bucket. The bucket key is the SHA-256 of the user's token, so the token itself is never stored. The Lambda role can read and write `tenants/*` in that one bucket and nothing else.

`deploy.sh` creates or updates the bucket, the role, the function, and the public Function URL. It's safe to rerun.

```sh
./deploy.sh          # prints the Function URL
node lambda/test.mjs # handler checks against an in-memory store
```

## Security model

The token in the URL is the only key: 256 random bits, generated on first push and kept in `~/.skill-relay/token`. Anyone with your connector URL can read your skills, so treat it like a password. Bundles are capped at 20 MB uncompressed.

## How a coding agent built it

Claude Code built and shipped this in one evening, with the AWS CLI as its connection to the account. It wrote the handler and its tests first, then `deploy.sh`, ran it, and read the CloudWatch logs when the first live call returned 500. The fix was a missing `s3:ListBucket` grant: without it, S3 reports a missing bundle as AccessDenied instead of NoSuchKey. It then pushed a real skill library and checked the live catalog over curl before the claude.ai test.

The demo library is 74 skills from public repos (coreyhaines31/marketingskills, firecrawl, heygen-com/hyperframes, vercel-labs/skills, remotion-dev/skills). Each one was checked against the git tree hash recorded at install time, and only exact matches were pushed. `allow.json` is that list.

## What I'd do with more time

- OAuth instead of a token in the URL, so the claude.ai connector can be shared across a team without sharing a secret.
- Team libraries: one bundle many people connect to, with per-person overrides.
- Push on save, from a Claude Code hook, so the web copy is never stale.
