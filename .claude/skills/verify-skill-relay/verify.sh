#!/usr/bin/env bash
# Drives Skill Relay the way a new user does: fresh clone, fake HOME, real push, live MCP calls.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
STATE="$REPO/.verify/state"
EVID_ROOT="$REPO/.verify/evidence"
FN=skill-relay

load() { [ -f "$STATE" ] || { echo "no instance; run: verify.sh up" >&2; exit 1; }; . "$STATE"; }
url() { aws lambda get-function-url-config --function-name "$FN" --query FunctionUrl --output text | sed 's#/$##'; }
log() { tee -a "$EVID/transcript.txt"; }

cmd="${1:-}"; shift || true
case "$cmd" in
  up)
    [ -f "$STATE" ] && { echo "an instance is already up ($STATE); run down first" >&2; exit 1; }
    SRC="${1:-https://github.com/ricardodreyes/skill-relay}"
    DIR="$(mktemp -d "${TMPDIR:-/tmp}/skill-relay-verify.XXXX")"
    EVID="$EVID_ROOT/$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$(dirname "$STATE")" "$EVID" "$DIR/home/.claude/skills/hello-world/references"
    git clone -q "$SRC" "$DIR/repo"
    printf -- '---\nname: hello-world\ndescription: >-\n  Greets the user in pirate speak. Use when the user says ahoy.\n---\n# Hello\nSay ahoy matey.\n' > "$DIR/home/.claude/skills/hello-world/SKILL.md"
    echo 'pirate glossary' > "$DIR/home/.claude/skills/hello-world/references/glossary.md"
    printf 'DIR=%q\nEVID=%q\n' "$DIR" "$EVID" > "$STATE"
    echo "up: clone of $SRC at $(git -C "$DIR/repo" log --oneline -1) in $DIR" | tee "$EVID/transcript.txt"
    echo "evidence: $EVID"
    ;;
  doctor)
    U="$(url)"
    echo "account: $(aws sts get-caller-identity --query Account --output text)"
    aws lambda get-function --function-name "$FN" --query 'Configuration.{state:State,update:LastUpdateStatus,modified:LastModified,runtime:Runtime}' --output text
    echo "landing: $(curl -s -o /dev/null -w '%{http_code}' "$U/")"
    [ -f "$STATE" ] && { . "$STATE"; echo "instance: $DIR"; } || echo "instance: none"
    ;;
  push)
    load
    (cd "$DIR" && HOME="$DIR/home" node repo/bin/push.mjs "$@") 2>&1 | sed -E 's#/t/[A-Za-z0-9_-]+/#/t/<token>/#' | log
    ;;
  rpc)
    load
    T="$(cat "$DIR/home/.skill-relay/token")"
    echo "> $1" | log
    curl -s -X POST "$(url)/t/$T/mcp" -H 'content-type: application/json' -d "$1" | log
    echo | log
    ;;
  call)
    load
    ARGS="${2:-}"; [ -n "$ARGS" ] || ARGS='{}'
    "$0" rpc "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/call\",\"params\":{\"name\":\"$1\",\"arguments\":$ARGS}}"
    ;;
  logs)
    load
    for i in 1 2 3 4 5 6; do
      OUT="$(aws logs tail "/aws/lambda/$FN" --since "${1:-10}m" --format short | grep '"rpc"' || true)"
      [ -n "$OUT" ] && break
      sleep 5
    done
    echo "${OUT:-(no rpc lines after 30s; CloudWatch can lag)}" | log
    ;;
  down)
    load
    T="$(cat "$DIR/home/.skill-relay/token" 2>/dev/null || true)"
    if [ -n "$T" ]; then
      KEY="tenants/$(printf %s "$T" | shasum -a 256 | cut -d' ' -f1)/bundle.json"
      BUCKET="skill-relay-$(aws sts get-caller-identity --query Account --output text)"
      aws s3 rm "s3://$BUCKET/$KEY" >/dev/null && echo "removed test bundle $KEY"
    fi
    rm -rf "$DIR" "$STATE"
    echo "down; evidence kept at $EVID"
    ;;
  *)
    echo "usage: verify.sh up [repo-url-or-path] | doctor | push [--flags] | rpc '<json>' | call <tool> ['<args json>'] | logs [minutes] | down" >&2
    exit 2
    ;;
esac
