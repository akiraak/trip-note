#!/bin/bash
set -eu

cd "$(dirname "$0")"

PORT="${VIBEBOARD_PORT:-3010}"

# 既存のポート使用プロセスがあれば停止する
PIDS=$(lsof -ti tcp:"$PORT" || true)
if [ -n "$PIDS" ]; then
  echo "port $PORT を使用中のプロセスを停止します: $PIDS"
  kill $PIDS 2>/dev/null || true
  sleep 1
  # まだ残っていれば強制終了
  PIDS=$(lsof -ti tcp:"$PORT" || true)
  if [ -n "$PIDS" ]; then
    kill -9 $PIDS 2>/dev/null || true
    sleep 1
  fi
fi

exec node vibeboard/dist/cli.js --root . --port "$PORT" "$@"
