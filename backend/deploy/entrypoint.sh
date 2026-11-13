#!/bin/sh
set -eu
mkdir -p /data /backups
chown -R node:node /data /backups
exec su-exec node node /app/backend/deploy/index.js
