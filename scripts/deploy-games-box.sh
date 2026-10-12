#!/usr/bin/env bash
# Ship RUG LIFE from the PC to the games box (t4g.nano `games`, Cloudflare tunnel, systemd `ruglife` on :8796).
#   scripts/deploy-games-box.sh            # refuses while anyone is at a table on the box
#   scripts/deploy-games-box.sh --force    # ship anyway (a restart ends every live table: the server does not resume tables yet)
# Builds the client and the single-file server bundle HERE (never on the 412 MB box), grades the suite by exit code, rsyncs code
# (never data/), installs the unit when it changed, restarts, verifies /health and the client dist byte-for-byte.
set -euo pipefail
cd "$(dirname "$0")/.."
HOST=games; DST=/srv/games/ruglife; PORT=8796; FORCE=${1:-}

# 1. who is at a table ON THE BOX. /health carries sockets (live websockets) and tables; a first deploy has no service yet (curl fails → empty).
HEALTH=$(ssh $HOST "curl -s -m 8 localhost:$PORT/health || true")
if [ -n "$HEALTH" ]; then
  SOCK=$(echo "$HEALTH" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("sockets",0))')
  if [ "$SOCK" != "0" ] && [ "$FORCE" != "--force" ]; then echo "⛔ $SOCK live socket(s) on RUG LIFE — not deploying. Wait for an idle table or --force."; exit 1; fi
  echo "box: $HEALTH"
else
  echo "box: no RUG LIFE service answering yet (first deploy)"
fi

# 2. build + bundle + test, all by exit code
npm run build >/tmp/ruglife-deploy.log 2>&1 || { echo "⛔ client build failed"; tail -20 /tmp/ruglife-deploy.log; exit 1; }
node scripts/bundle-server.mjs >>/tmp/ruglife-deploy.log 2>&1 || { echo "⛔ server bundle failed"; tail -20 /tmp/ruglife-deploy.log; exit 1; }
npm test >>/tmp/ruglife-deploy.log 2>&1 || { echo "⛔ tests failed — see /tmp/ruglife-deploy.log"; grep -E 'Tests|FAIL' /tmp/ruglife-deploy.log | tail -5; exit 1; }
echo "tests: $(grep -E '^ +Tests ' /tmp/ruglife-deploy.log | tail -1 | xargs)"

# 2b. look again right before touching the box
if [ -n "$HEALTH" ] && [ "$FORCE" != "--force" ]; then
  SOCK=$(ssh $HOST "curl -s -m 8 localhost:$PORT/health || true" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("sockets",0))' 2>/dev/null || echo 0)
  if [ "$SOCK" != "0" ]; then echo "⛔ somebody connected while the build ran ($SOCK socket(s)) — NOT shipping."; exit 1; fi
fi

# 3. ship code, never data. Layout on the box mirrors the repo paths the server reads relative to its cwd.
ssh $HOST "sudo mkdir -p $DST/data $DST/dist/server $DST/packages/client && sudo chown -R ec2-user:ec2-user $DST"
rsync -az --delete dist/server/ $HOST:$DST/dist/server/
rsync -az --delete packages/client/dist/ $HOST:$DST/packages/client/dist/
rsync -az deploy/ruglife.service $HOST:/tmp/ruglife.service
git log -1 --format="commit %H%nsubject %s%ndeployed $(date -u +%FT%TZ)" | ssh $HOST "cat > $DST/DEPLOYED"

# 4. the unit: install when it differs, then (re)start
ssh $HOST 'if ! sudo cmp -s /tmp/ruglife.service /etc/systemd/system/ruglife.service; then sudo cp /tmp/ruglife.service /etc/systemd/system/ruglife.service && sudo systemctl daemon-reload && echo "unit installed"; fi; sudo systemctl enable -q ruglife; sudo systemctl restart ruglife; sleep 2; systemctl is-active ruglife'

# 5. verify: /health on the box and the built client byte-for-byte
H=$(ssh $HOST "curl -s -m 8 localhost:$PORT/health || true"); echo "health: ${H:-NO ANSWER}"; [ -n "$H" ] || { ssh $HOST "tail -20 /var/log/ruglife.log"; exit 1; }
L=$(cd packages/client/dist && find . -type f -exec md5sum {} + | sort -k2 | md5sum | cut -c1-12)
R=$(ssh $HOST "cd $DST/packages/client/dist && find . -type f -exec md5sum {} + | sort -k2 | md5sum | cut -c1-12")
[ "$L" = "$R" ] && echo "client dist verified ($L)" || { echo "⛔ client dist differs: local $L box $R"; exit 1; }
ssh $HOST "cat $DST/DEPLOYED; free -m | sed -n 2p; systemctl show ruglife -p MemoryCurrent"
