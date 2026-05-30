#!/bin/bash
# Auto-reconnect tunnel for Night FM
# Keeps the public URL alive by reconnecting when dropped

while true; do
  echo "[$(date '+%H:%M:%S')] Starting tunnel..."
  ssh -o StrictHostKeyChecking=no \
      -o ServerAliveInterval=30 \
      -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes \
      -R 80:localhost:3000 \
      nokey@localhost.run 2>&1
  echo "[$(date '+%H:%M:%S')] Tunnel dropped. Reconnecting in 5 seconds..."
  sleep 5
done
