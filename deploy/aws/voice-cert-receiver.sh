#!/bin/sh
# Forced SSH command for the dedicated, unprivileged certificate sync account.
exec sudo -n /usr/local/sbin/voice-install-cert
