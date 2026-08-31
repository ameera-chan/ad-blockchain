#!/usr/bin/env sh
set -e

# Gateway + anvil are supervised by supervisord. This entrypoint exists as a
# single, explicit startup hook so any pre-boot setup (key generation, runtime/
# state initialisation) can be added here without touching supervisord.
exec supervisord -c /etc/supervisord.conf
