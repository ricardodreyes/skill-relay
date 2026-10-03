---
name: verify-skill-relay
description: "Use when you need to prove Skill Relay works end to end: after changing lambda/index.mjs, bin/push.mjs, deploy.sh or the README setup steps, before calling a change done, or when claude.ai stops loading skills. Drives a fresh clone with a fake HOME, a real push, live MCP JSON-RPC calls against the deployed Lambda, and the Lambda logs."
---

# Verify Skill Relay

Skill Relay has two surfaces. The **push CLI** (`bin/push.mjs`) a user runs from a clone, and the **MCP endpoint** (`lambda/index.mjs` behind a Lambda Function URL) that claude.ai calls. Everything here runs through `verify.sh` in this folder.

```bash
V=.claude/skills/verify-skill-relay/verify.sh   # run from the repo root
```

## Launch

```bash
$V up                     # clones github.com/ricardodreyes/skill-relay (what users get)
$V up "$PWD"              # or clone the local repo: tests committed HEAD, not the working tree
```

`up` makes a temp dir with a clone, a fake `HOME`, and one fixture skill (`hello-world`, with `references/glossary.md`). It prints the evidence folder. Ready when it prints `up: clone of <sha>`.

Lambda changes are not live until you deploy them. Run `./deploy.sh` from the repo root first, and wait for it to print the Function URL. Deploying replaces production, so do it only for changes you mean to ship.

## Doctor

```bash
$V doctor
```

Read-only. It prints the AWS account, the function's `Active` / `Successful` state with `LastModified`, the landing page status (expect `200`), and whether an instance is up. If `LastModified` is older than your last deploy, the deploy didn't land. An expired AWS session shows up here as "Your session has expired"; ask the user to run `! aws login`.

## Drive

```bash
$V push                                   # real push of the fixture, as a new user
$V rpc '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'
$V rpc '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
$V call hello-world                       # a skill is a tool named after it
$V call read_skill_file '{"name":"hello-world","path":"references/glossary.md"}'
$V logs 10                                # rpc lines the Lambda logged in the last 10 minutes
```

The fixture tenant has its own token in the fake `HOME`, so it never touches the user's real tenant (`~/.skill-relay/token`). Never push with the real `HOME` from here.

To add fixtures (a planted secret, a `.relayignore`, a binary file), write them under `$DIR/home/.claude/skills/` (`. .verify/state` gives you `$DIR`). Build any fake secret at runtime from pieces (`'gh' + 'p_' + 'x'*36`); a literal fake key in a command gets blocked.

## Evidence

Every `push`, `rpc`, `call` and `logs` appends to `.verify/evidence/<timestamp>/transcript.txt`, with connector tokens masked. That folder survives `down` and is gitignored.

Proof standards:
- Go through the real user path: the cloned `bin/push.mjs` and the public Function URL. Don't call `handle()` directly; that's what `node lambda/test.mjs` is for.
- Check the result and the side effect: a push should both print `Pushed N skill(s)` and change what `tools/list` returns.
- For claude.ai behavior, the Lambda log is the ground truth. A chat that "looks like" it used a skill without a matching `tools/call` line in `$V logs` didn't.

## Cleanup

```bash
$V down
```

Deletes the S3 bundle for the fixture tenant (only that key), the temp dir, and `.verify/state`. It never touches the user's tenant or the evidence folder. Run it after failed attempts too.

## Features

`features/README.md` maps what to drive. Start there for anything beyond the commands above.
