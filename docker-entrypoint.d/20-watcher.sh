#!/bin/sh
# Start the failure watcher beside nginx.
#
# nginx's own entrypoint runs everything in this directory before exec'ing nginx
# in the foreground, so the watcher goes to the background behind a restart loop:
# an add-on that is still serving pages while nothing is watching the printer is
# worse than one that is plainly down.
[ -f /app/watcher.mjs ] || exit 0
(
  while true; do
    node /app/watcher.mjs
    echo "[watch] exited with status $?; restarting in 10s" >&2
    sleep 10
  done
) &
