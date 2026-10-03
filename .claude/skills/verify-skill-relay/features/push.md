# Pushing skills

## Sub-features
- Reads `~/.claude/skills` (or `--dir`), follows symlinks, keeps folders with a SKILL.md
- Parses `description:` from frontmatter, including folded `>-` blocks
- Skips binaries and files over 200 KB, plus `.git`, `node_modules`, `__pycache__`, `.venv`
- Refuses the whole push if any file matches a secret pattern; exit 1
- `.relayignore` (one folder name per line) and `--only names.json`
- Makes a 256-bit token on first run at `~/.skill-relay/token` (mode 600) and reuses it
- Friendly error and exit 1 when the skills folder doesn't exist

## How to get to it (user POV)
`git clone https://github.com/ricardodreyes/skill-relay && node skill-relay/bin/push.mjs`. It prints `Pushed N skills (X KB gzipped).` and the connector URL.

## Driving it with verify.sh
`$V up`, then `$V push`. Expect `Pushed 1 skill (... bytes gzipped).` For refusal, plant a token-looking string in a fixture SKILL.md and expect `Refusing to push` naming the file. For ignore, add the folder name to `$DIR/home/.claude/skills/.relayignore` and confirm it vanishes from `$V rpc tools/list`.

## Gotchas
- Lambda caps a request body at 6 MB; the push is gzipped and base64'd by the Function URL, so roughly 4 MB of gzip is the practical ceiling.
- Binary skips are silent; check `tools/list` file listings if a file seems missing.
- A literal fake secret in a shell command gets blocked by the permission layer; build it at runtime.
