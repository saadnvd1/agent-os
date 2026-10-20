#!/usr/bin/env bash
# CI check of the linked-machine path, from one AgentOS machine to another
# (here the same box, over ssh to localhost): the exact steps lib/hosts/link.ts
# takes. ssh in for a pairing code on the machine's own loopback, claim it over
# HTTP, keep the device token, and call the machine's API with it. Run with
# the server already up on $1 (default 3011) and sshd running.
set -euo pipefail

port="${1:-3011}"
key="$(mktemp -d)/id"
ssh-keygen -q -t ed25519 -N "" -f "$key"
mkdir -p ~/.ssh && chmod 700 ~/.ssh
cat "$key.pub" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys

ssh_run() {
    ssh -i "$key" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
        -o UserKnownHostsFile="$(dirname "$key")/known_hosts" localhost "$@"
}

code=$(ssh_run "curl -fsS -m 10 -X POST http://127.0.0.1:$port/api/pair/start" \
    | sed -n 's/.*"code":"\([^"]*\)".*/\1/p')
[[ -n "$code" ]] || { echo "no pairing code"; exit 1; }

headers=$(curl -fsS -D - -o /dev/null -X POST "http://localhost:$port/api/pair/claim" \
    -H 'Content-Type: application/json' \
    -d "{\"code\":\"$code\",\"name\":\"AgentOS CI\"}")
token=$(printf '%s' "$headers" | tr -d '\r' | sed -n 's/^[Ss]et-[Cc]ookie: *[^=]*=\([^;]*\).*/\1/p' | head -1)
[[ -n "$token" ]] || { echo "no device token in the claim response"; exit 1; }

curl -fsS -H "Authorization: Bearer $token" "http://localhost:$port/api/tasks" > /dev/null
echo "machine link path ok (ssh -> pair -> token -> API)"
