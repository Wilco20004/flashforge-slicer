#!/bin/sh
# Make sure the nginx worker can write the settings store, whatever mounted /data.
mkdir -p /data/.tmp
chown -R nginx:nginx /data 2>/dev/null || true
chmod 775 /data /data/.tmp 2>/dev/null || true
