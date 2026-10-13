#!/bin/sh
set -eu

CONFIG="deploy/wrangler.vps.jsonc"
PERSIST="/data"
PORT="3000"
MEMORY_THRESHOLD_BYTES=$((1200 * 1024 * 1024))

memory_pressure() {
  if [ ! -r /sys/fs/cgroup/memory.current ]; then
    return 1
  fi
  current_bytes="$(cat /sys/fs/cgroup/memory.current 2>/dev/null || echo 0)"
  [ "$current_bytes" -ge "$MEMORY_THRESHOLD_BYTES" ]
}

wrangler d1 migrations apply servicepilot-vps --local --persist-to "$PERSIST" --config "$CONFIG"

while :; do
  wrangler dev --show-interactive-dev-session false --log-level error --config "$CONFIG" --ip 0.0.0.0 --port "$PORT" --persist-to "$PERSIST" &
  worker_pid=$!
  # The bundled RSC worker can take longer to cold-start after a larger UI build.
  # Keep the container alive long enough for the readiness probe to observe it.
  ready_deadline=$(( $(date +%s) + 180 ))
  healthy=0

  while kill -0 "$worker_pid" 2>/dev/null; do
    if node -e "fetch('http://127.0.0.1:${PORT}/').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"; then
      healthy=1
      break
    fi
    if [ "$(date +%s)" -ge "$ready_deadline" ]; then
      break
    fi
    sleep 5
  done

  if [ "$healthy" -eq 0 ]; then
    kill "$worker_pid" 2>/dev/null || true
    wait "$worker_pid" 2>/dev/null || true
    exit 1
  fi

  failed_checks=0
  while kill -0 "$worker_pid" 2>/dev/null; do
    sleep 15
    if memory_pressure; then
      echo "Worker memory reached ${MEMORY_THRESHOLD_BYTES} bytes; restarting before V8 OOM" >&2
      kill "$worker_pid" 2>/dev/null || true
      wait "$worker_pid" 2>/dev/null || true
      exit 1
    fi
    if node -e "fetch('http://127.0.0.1:${PORT}/').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"; then
      failed_checks=0
    else
      failed_checks=$((failed_checks + 1))
    fi
    if [ "$failed_checks" -ge 3 ]; then
      kill "$worker_pid" 2>/dev/null || true
      wait "$worker_pid" 2>/dev/null || true
      break
    fi
  done

  if ! kill -0 "$worker_pid" 2>/dev/null; then
    wait "$worker_pid" 2>/dev/null || true
    exit 1
  fi
  sleep 2
done
