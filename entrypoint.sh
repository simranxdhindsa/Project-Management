#!/bin/sh
set -e

echo "[entrypoint] starting Velocity API server on :$PORT..."
exec /app/server
