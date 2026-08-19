#!/usr/bin/env bash
# One-time bootstrap for the AIOps demo EC2 instance.
# Run via SSM Run Command after `sam deploy`.

set -euo pipefail

# ── Node.js 22 + jq ───────────────────────────────────────────────────────────
curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
yum install -y nodejs jq

# ── Dedicated service user ────────────────────────────────────────────────────
id aiops &>/dev/null || useradd \
  --system \
  --no-create-home \
  --shell /sbin/nologin \
  aiops

# ── Application directory layout ──────────────────────────────────────────────
install -d -m 0755 -o aiops -g aiops \
  /opt/aiops-demo-app/releases

install -d -m 0750 -o aiops -g aiops \
  /opt/aiops-demo-app/config

# ── Persistent configuration ──────────────────────────────────────────────────
# Secrets live here and are never overwritten by deployments.
if [[ ! -f /opt/aiops-demo-app/config/production.env ]]; then
  printf 'PORT=3000\nNODE_ENV=production\nDEMO_CONTROL_TOKEN=change-me\n' \
    > /opt/aiops-demo-app/config/production.env

  chmod 600 /opt/aiops-demo-app/config/production.env
  chown aiops:aiops /opt/aiops-demo-app/config/production.env
fi

# ── systemd service ───────────────────────────────────────────────────────────
cat > /etc/systemd/system/aiops-demo-app.service <<'UNIT'
[Unit]
Description=AIOps Demo Application
After=network.target

[Service]
Type=simple
User=aiops
Group=aiops

WorkingDirectory=/opt/aiops-demo-app/current

EnvironmentFile=/opt/aiops-demo-app/config/production.env
EnvironmentFile=/opt/aiops-demo-app/current/.env

ExecStart=/usr/bin/node /opt/aiops-demo-app/current/dist/server.js

Restart=on-failure
RestartSec=5

StandardOutput=journal
StandardError=journal
SyslogIdentifier=aiops-demo-app

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable aiops-demo-app

echo "Bootstrap complete."
echo
echo "Next steps:"
echo "1. Set DEMO_CONTROL_TOKEN in:"
echo "   /opt/aiops-demo-app/config/production.env"
echo "2. Push to main to trigger the GitHub Actions deployment."