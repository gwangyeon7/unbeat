#!/usr/bin/env bash
# dev-up.sh로 백그라운드로 띄운 uvicorn/ngrok을 정리함.
# 레디스는 계속 켜둬도 되는 상시 서비스라 여기선 안 끔 — 진짜 끄고 싶으면
# 직접 `brew services stop redis` 실행.
cd "$(dirname "$0")"

for name in uvicorn ngrok; do
  pidfile=".pids/$name.pid"
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      echo "[$name] 종료함 (PID $pid)"
    else
      echo "[$name] 이미 꺼져있었음"
    fi
    rm -f "$pidfile"
  else
    echo "[$name] PID 파일 없음 (dev-up.sh로 안 켰거나 이미 정리됨)"
  fi
done
