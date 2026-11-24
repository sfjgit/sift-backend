#!/usr/bin/env bash
# Prints the current public address of this PC's CRM backend (from the tunnel's log).
url=$(journalctl --user -u crm-tunnel --no-pager -n 200 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
if [ -z "$url" ]; then
  echo "No tunnel address yet. Is it running?  systemctl --user status crm-tunnel"
  exit 1
fi
echo "Backend for the devs:  $url"
echo "Frontend .env:         NEXT_PUBLIC_API_URL=$url"
echo "Health check:          $url/health"
