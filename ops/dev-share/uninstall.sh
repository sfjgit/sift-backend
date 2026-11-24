#!/usr/bin/env bash
# Stops and removes the background backend + tunnel (sleep works normally again).
systemctl --user disable --now crm-tunnel.service crm-core.service 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/crm-tunnel.service" "$HOME/.config/systemd/user/crm-core.service"
systemctl --user daemon-reload
echo "Removed. (cloudflared stays in ~/.local/bin — delete it if you like.)"
