#!/bin/sh
# Certbot deploy hook, run only after issue/renewal on the East server.
set -eu
umask 077
work=$(mktemp -d /run/voice-cert-deploy-XXXXXX)
trap 'find "$work" -maxdepth 1 -type f -delete; rmdir "$work"' EXIT
cp -L /etc/letsencrypt/live/api.260926731.xyz/fullchain.pem "$work/fullchain.pem"
cp -L /etc/letsencrypt/live/api.260926731.xyz/privkey.pem "$work/privkey.pem"
tar -czf "$work/bundle.tar.gz" -C "$work" fullchain.pem privkey.pem
/usr/local/sbin/voice-install-cert < "$work/bundle.tar.gz"
ssh -T -i /etc/voice-ai-toy/cert-sync-west.key \
  -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=/etc/voice-ai-toy/cert-sync-known-hosts \
  voice-cert-sync@100.23.30.205 < "$work/bundle.tar.gz"
