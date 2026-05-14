#!/bin/sh
set -e

# Start Go backend on internal port 8081 (nginx owns 8080)
PORT=8081 /app/server &
SERVER_PID=$!

# Wait for Go backend to be ready before starting nginx
echo "[entrypoint] waiting for Go backend on :8081..."
until curl -sf http://localhost:8081/api/health > /dev/null 2>&1; do sleep 1; done

# Start nginx — backend is ready, static files are already on disk
nginx -g "daemon off;" &
NGINX_PID=$!

echo "[entrypoint] all services up"

# Forward SIGTERM/SIGINT to all background processes
shutdown() {
    echo "[entrypoint] shutting down..."
    kill "$SERVER_PID" "$NGINX_PID" 2>/dev/null
    wait "$SERVER_PID" "$NGINX_PID" 2>/dev/null
    exit 0
}
trap shutdown TERM INT

# Wait indefinitely — exit when any child dies
wait
