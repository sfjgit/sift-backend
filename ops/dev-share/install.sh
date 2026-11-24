#!/usr/bin/env bash
# One-time setup: run this yourself (it installs and starts two background services).
#   cd "crm-core-service/ops/dev-share" && ./install.sh
# Undo: ./uninstall.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

# 1. the tunnel program (one file, in your home folder; no sudo)
if [ ! -x "$HOME/.local/bin/cloudflared" ]; then
  echo "▶ Downloading cloudflared (Cloudflare's tunnel program)…"
  mkdir -p "$HOME/.local/bin"
  curl -fsSL -o "$HOME/.local/bin/cloudflared" \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
  chmod +x "$HOME/.local/bin/cloudflared"
fi
"$HOME/.local/bin/cloudflared" --version

# 2. stop a backend you may have started by hand (port 5005 must be free)
if ss -ltn | grep -q ':5005 '; then
  echo "⚠ Something already listens on port 5005 (a backend started in a terminal?). Stop it (Ctrl+C there) and run this again."
  exit 1
fi

# 3. the two services
echo "▶ Installing the services…"
mkdir -p "$HOME/.config/systemd/user"
cp "$here/crm-core.service" "$here/crm-tunnel.service" "$HOME/.config/systemd/user/"
systemctl --user daemon-reload
systemctl --user enable --now crm-core.service crm-tunnel.service

# 4. keep them running without you being logged in (asks for your password once)
loginctl enable-linger "$USER" || echo "⚠ Could not enable linger — the services then run only while you are logged in."

echo "▶ Waiting for the tunnel address…"
for _ in $(seq 1 30); do sleep 2; "$here/url.sh" >/dev/null 2>&1 && break; done
"$here/url.sh"
