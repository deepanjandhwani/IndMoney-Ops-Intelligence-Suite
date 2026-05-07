#!/bin/sh
set -e

mkdir -p /app/credentials

if [ -n "$GOOGLE_CREDENTIALS_JSON_B64" ]; then
  echo "$GOOGLE_CREDENTIALS_JSON_B64" | base64 -d > /app/credentials/credentials.json
  export GOOGLE_CREDENTIALS_PATH=/app/credentials/credentials.json
fi

if [ -n "$GOOGLE_TOKEN_JSON_B64" ]; then
  echo "$GOOGLE_TOKEN_JSON_B64" | base64 -d > /app/credentials/token.json
  export GOOGLE_TOKEN_PATH=/app/credentials/token.json
fi

exec python3 mcp/groww_ops_mcp_server.py
