#!/usr/bin/env bash
#
# Bring the local demo up from nothing and print sign-in links.
#
# Written because this gets rebuilt often: the dev sandbox loses node_modules, the
# local D1 database and the tunnel binary whenever the machine is recycled, and the
# Cloudflare quick tunnel comes back on a different hostname each time. Everything
# here is idempotent, so it is safe to run whether the box is fresh or half-up.
#
# Usage:  bash scripts/demo.sh
set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMUX="tmux -f /exec-daemon/tmux.portal.conf"
CLOUDFLARED="${CLOUDFLARED:-/tmp/cloudflared}"
PORT=4321

cd "$APP_DIR"
say() { printf '%s\n' "$*"; }

# ---- dependencies and database ---------------------------------------------

if [ ! -d node_modules ]; then
  say "deps: installing"
  npm install --silent
fi

if [ ! -d .wrangler ] || [ "${FORCE_SEED:-}" = "1" ]; then
  say "database: migrating and seeding"
  npx wrangler d1 migrations apply betal --local >/dev/null 2>&1
  npm run seed >/dev/null 2>&1
fi

# ---- local Skriva / Samleikin fixture --------------------------------------

if curl -sf -o /dev/null --max-time 3 "http://127.0.0.1:8790/health"; then
  say "skriva fixture: already running"
else
  say "skriva fixture: starting"
  $TMUX has-session -t "=betal-skriva" 2>/dev/null || \
    $TMUX new-session -d -s betal-skriva -c "$APP_DIR" -- "${SHELL:-bash}" -l
  $TMUX send-keys -t "betal-skriva:0.0" C-c 2>/dev/null
  sleep 1
  $TMUX send-keys -t "betal-skriva:0.0" \
    "cd '$APP_DIR' && npm run fixtures:skriva" C-m
fi

# ---- dev server -------------------------------------------------------------

if curl -sf -o /dev/null --max-time 5 "http://localhost:$PORT/innrita"; then
  say "dev server: already running"
else
  say "dev server: starting"
  $TMUX has-session -t "=betal-dev" 2>/dev/null || \
    $TMUX new-session -d -s betal-dev -c "$APP_DIR" -- "${SHELL:-bash}" -l
  # A stale Vite dep cache is the usual cause of a server that boots but then 500s
  # on every route, so it is cleared rather than trusted.
  rm -rf node_modules/.vite
  $TMUX send-keys -t "betal-dev:0.0" C-c 2>/dev/null
  sleep 2
  $TMUX send-keys -t "betal-dev:0.0" \
    "cd '$APP_DIR' && npm run dev -- --host 2>&1 | tee /tmp/dev.log" C-m

  for _ in $(seq 1 40); do
    sleep 2
    curl -sf -o /dev/null --max-time 3 "http://localhost:$PORT/innrita" && break
  done
fi

if ! curl -sf -o /dev/null --max-time 5 "http://localhost:$PORT/innrita"; then
  say "dev server: failed to come up — see /tmp/dev.log"
  exit 1
fi

# ---- tunnel -----------------------------------------------------------------

if [ ! -x "$CLOUDFLARED" ]; then
  say "tunnel: downloading cloudflared"
  curl -sL --max-time 120 -o "$CLOUDFLARED" \
    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x "$CLOUDFLARED"
fi

say "tunnel: starting"
$TMUX has-session -t "=betal-tunnel" 2>/dev/null || \
  $TMUX new-session -d -s betal-tunnel -c /tmp -- "${SHELL:-bash}" -l
$TMUX send-keys -t "betal-tunnel:0.0" C-c 2>/dev/null
sleep 2
rm -f /tmp/tunnel.log
$TMUX send-keys -t "betal-tunnel:0.0" \
  "$CLOUDFLARED tunnel --url http://localhost:$PORT --no-autoupdate 2>&1 | tee /tmp/tunnel.log" C-m

BASE=""
for _ in $(seq 1 25); do
  sleep 2
  BASE=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/tunnel.log 2>/dev/null | head -1)
  [ -n "$BASE" ] && break
done

if [ -z "$BASE" ]; then
  say "tunnel: failed to come up — see /tmp/tunnel.log"
  exit 1
fi

say "skriva tunnel: starting"
$TMUX has-session -t "=betal-skriva-tunnel" 2>/dev/null || \
  $TMUX new-session -d -s betal-skriva-tunnel -c /tmp -- "${SHELL:-bash}" -l
$TMUX send-keys -t "betal-skriva-tunnel:0.0" C-c 2>/dev/null
sleep 2
rm -f /tmp/skriva-tunnel.log
$TMUX send-keys -t "betal-skriva-tunnel:0.0" \
  "$CLOUDFLARED tunnel --url http://127.0.0.1:8790 --no-autoupdate 2>&1 | tee /tmp/skriva-tunnel.log" C-m

SKRIVA_PUBLIC=""
for _ in $(seq 1 25); do
  sleep 2
  SKRIVA_PUBLIC=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/skriva-tunnel.log 2>/dev/null | head -1)
  [ -n "$SKRIVA_PUBLIC" ] && break
done

if [ -z "$SKRIVA_PUBLIC" ]; then
  say "skriva tunnel: failed to come up — see /tmp/skriva-tunnel.log"
  exit 1
fi

# Redirects after Samleikin must land on the same host the merchant opened.
if [ -f "$APP_DIR/.dev.vars" ]; then
  python3 - "$APP_DIR/.dev.vars" "$BASE" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
base = sys.argv[2]
text = path.read_text()
if 'APP_URL=' in text:
    lines = []
    for line in text.splitlines(True):
        if line.startswith("APP_URL="):
            lines.append(f'APP_URL="{base}"\n')
        else:
            lines.append(line)
    path.write_text("".join(lines))
else:
    path.write_text(text.rstrip() + f'\nAPP_URL="{base}"\n')
PY
fi

say "skriva fixture: restarting with public signing URLs"
$TMUX send-keys -t "betal-skriva:0.0" C-c
sleep 1
$TMUX send-keys -t "betal-skriva:0.0" \
  "cd '$APP_DIR' && SKRIVA_PUBLIC_URL='$SKRIVA_PUBLIC' npm run fixtures:skriva" C-m

say "dev server: restarting so APP_URL is the tunnel"
$TMUX send-keys -t "betal-dev:0.0" C-c
sleep 2
$TMUX send-keys -t "betal-dev:0.0" \
  "cd '$APP_DIR' && npm run dev -- --host 0.0.0.0 > /tmp/betal-dev.log 2>&1" C-m
for _ in $(seq 1 40); do
  sleep 2
  curl -sf -o /dev/null --max-time 3 "http://127.0.0.1:$PORT/innrita" && break
done

# ---- login links ------------------------------------------------------------

# Real magic-link tokens through the normal auth flow. Only the email delivery is
# missing, so this stands in for the message rather than bypassing the login.
node -e "
const {createHash,randomBytes}=require('node:crypto');const fs=require('node:fs');
const t={
  merchant:randomBytes(24).toString('hex'),
  staff:randomBytes(24).toString('hex'),
  onboarding:randomBytes(24).toString('hex'),
};
const exp=Date.now()+24*60*60*1000;const sql=[];
const emails={staff:'ingvar@betal.fo',merchant:'eigari@kaffihusid.fo',onboarding:'eigari@handilin.fo'};
for(const[w,tok]of Object.entries(t)){
  const h=createHash('sha256').update(tok).digest('hex');
  sql.push(\`INSERT INTO login_token (token_hash,user_id,expires_at_ms,created_at_ms) SELECT '\${h}', id, \${exp}, \${Date.now()} FROM app_user WHERE email='\${emails[w]}';\`);
}
fs.writeFileSync('/tmp/demo-tokens.sql',sql.join('\n'));
fs.writeFileSync('/tmp/demo-tokens.json',JSON.stringify(t));
"
npx wrangler d1 execute betal --local --file=/tmp/demo-tokens.sql >/dev/null 2>&1

say ""
say "tunnel responds: $(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$BASE/innrita")"
say ""
say "ONBOARDING: $BASE/api/auth/vatta?token=$(node -p "require('/tmp/demo-tokens.json').onboarding")&next=/umbon/66666666-6666-4666-8666-666666666666/undirskriva"
say "MERCHANT:   $BASE/api/auth/vatta?token=$(node -p "require('/tmp/demo-tokens.json').merchant")"
say "STAFF:      $BASE/api/auth/vatta?token=$(node -p "require('/tmp/demo-tokens.json').staff")"
say ""
say "Single use, valid 24 hours. The tunnel hostname changes on every restart."
