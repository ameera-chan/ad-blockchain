#!/usr/bin/env sh
set -eu

mkdir -p /data/secrets
chown -R node:node /data

exec supervisord -c /etc/supervisord.conf