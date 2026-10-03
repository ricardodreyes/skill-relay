# Skills as MCP tools

## Sub-features
- `initialize` echoes a supported protocol version (2025-06-18, 2025-03-26, 2024-11-05), falls back to the newest
- `tools/list`: one tool per skill (name = folder name, description = the skill's description) plus `read_skill_file`
- `tools/call <skill>` returns `# Skill: <name>`, the SKILL.md, and a list of the skill's other files
- `read_skill_file(name, path)` returns one file; unknown names/paths return `isError: true` with the valid options
- `prompts/list` / `prompts/get` expose the same skills as prompts
- Notifications get 202, GET on the MCP path gets 405, a malformed token gets 404

## How to get to it (user POV)
The user never calls this by hand; claude.ai does, through the connector URL the push printed.

## Driving it with verify.sh
`$V rpc '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'` and `$V call hello-world`. End state: `tools/list` names are `["hello-world","read_skill_file"]`, and the call returns `Say ahoy matey.` followed by `- references/glossary.md`.

## Gotchas
- Skill folder names that aren't `[A-Za-z0-9_-]{1,64}` are dropped from `tools/list` (MCP tool-name rule) but still reachable as prompts.
- Every request reads the whole bundle from S3; a 74-skill library measured p50 489 ms warm. Slow is expected, errors are not.
- Lambda logs one `{"rpc":...,"tool":...}` line per request; `$V logs` filters to those.
