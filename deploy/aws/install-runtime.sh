#!/usr/bin/env bash
set -euo pipefail

# Run on one dedicated Voice AI Toy Lightsail instance after uploading the
# source archive to /tmp/voice-ai-toy-runtime.tgz.
NODE_VERSION=24.21.0
NODE_ARCHIVE="node-v${NODE_VERSION}-linux-x64.tar.xz"
NODE_SHA256=fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6
VOICE_STAGE_DIR=$(mktemp -d /tmp/voice-ai-toy-install.XXXXXXXX)

sudo install -d -m 755 /opt/voice-ai-toy /opt/voice-ai-toy/current /opt/voice-ai-toy/node
sudo install -d -m 700 /etc/voice-ai-toy
if ! id voice-ai-toy >/dev/null 2>&1; then
  sudo useradd --system --no-create-home --home-dir /opt/voice-ai-toy --shell /usr/sbin/nologin voice-ai-toy
fi

curl --fail --silent --show-error --location \
  "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}" \
  --output "${VOICE_STAGE_DIR}/${NODE_ARCHIVE}"
printf '%s  %s\n' "$NODE_SHA256" "${VOICE_STAGE_DIR}/${NODE_ARCHIVE}" | sha256sum --check -
sudo tar --extract --xz --file "${VOICE_STAGE_DIR}/${NODE_ARCHIVE}" \
  --directory /opt/voice-ai-toy/node --strip-components=1

sudo tar --extract --gzip --file /tmp/voice-ai-toy-runtime.tgz \
  --directory /opt/voice-ai-toy/current --no-same-owner
sudo env PATH="/opt/voice-ai-toy/node/bin:/usr/bin:/bin" \
  /opt/voice-ai-toy/node/bin/npm install \
  --prefix /opt/voice-ai-toy/current --omit=dev --no-audit --no-fund \
  --no-package-lock --save=false busboy@1.6.0 ws@8.21.3

if [ ! -x /opt/voice-ai-toy/tts/bin/python ]; then
  sudo python3 -m venv /opt/voice-ai-toy/tts
fi
sudo /opt/voice-ai-toy/tts/bin/pip install \
  --disable-pip-version-check --no-cache-dir 'edge-tts==7.2.8'

sudo install -m 644 /tmp/voice-ai-toy.service /etc/systemd/system/voice-ai-toy.service
sudo systemctl daemon-reload
printf 'Runtime installed; configure /etc/voice-ai-toy/runtime.env before starting.\n'
