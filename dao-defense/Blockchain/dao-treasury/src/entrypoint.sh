#!/usr/bin/env sh
set -e

# The gateway (gateway/server.js) is supervised by supervisord; it spawns anvil
# itself as a child process via deploy.js. This entrypoint is a single, explicit
# startup hook so any pre-boot setup (key generation, runtime/ state
# initialisation) can be added here without touching supervisord.
exec supervisord -c /etc/supervisord.conf
