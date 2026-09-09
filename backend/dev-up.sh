#!/usr/bin/env bash
# 개발 서버(레디스 + uvicorn 백엔드 + ngrok) 한 번에 켜기.
# "터미널을 몇 개씩 켜야 하고 레디스가 켜져있는지도 모르겠다"는 불편함으로 추가함.
# 사용법: ./dev-up.sh 로 켜고, 끝나면 ./dev-down.sh 로 정리. 프론트엔드(Next.js)는
# VS Code에서 그대로 켜면 되니까 여기 포함 안 함 — 이미 편하게 관리되고 있는 부분이라
# 손 안 댐. 로그는 backend/logs/에 쌓이니 뭔가 이상하면 거기서 확인하면 됨.
set -e
cd "$(dirname "$0")"

mkdir -p logs .pids

# 1) Redis — brew services로 이미 상시 실행 중이면 아무것도 안 하고, 꺼져있으면 그때만 시작
if redis-cli ping > /dev/null 2>&1; then
  echo "[redis] 이미 켜져 있음"
else
  echo "[redis] 꺼져있어서 brew services로 시작함"
  brew services start redis
  sleep 1
fi

# 2) uvicorn (FastAPI 백엔드, 8000번 포트) — 백그라운드로 띄우고 PID를 파일에 기록해서
#    나중에 dev-down.sh가 정확히 이 프로세스만 종료할 수 있게 함
if [ -f .pids/uvicorn.pid ] && kill -0 "$(cat .pids/uvicorn.pid)" 2>/dev/null; then
  echo "[uvicorn] 이미 켜져 있음 (PID $(cat .pids/uvicorn.pid))"
else
  echo "[uvicorn] 시작 중..."
  nohup ./venv/bin/python -m uvicorn main:app --reload --port 8000 > logs/uvicorn.log 2>&1 &
  echo $! > .pids/uvicorn.pid
  sleep 1
fi

# 3) ngrok — 프론트(3000번 포트)를 외부(폰)에서 접근 가능하게 노출
if [ -f .pids/ngrok.pid ] && kill -0 "$(cat .pids/ngrok.pid)" 2>/dev/null; then
  echo "[ngrok] 이미 켜져 있음 (PID $(cat .pids/ngrok.pid))"
else
  echo "[ngrok] 시작 중..."
  nohup ngrok http 3000 --log=stdout > logs/ngrok.log 2>&1 &
  echo $! > .pids/ngrok.pid
  sleep 2
fi

# ngrok의 로컬 관리 API(4040번 포트)에서 지금 발급된 공개 주소를 자동으로 읽어옴 —
# 매번 ngrok 창에서 눈으로 찾아 복사하는 대신, 스크립트 한 번으로 바로 보여주기 위함
NGROK_URL=$(curl -s http://127.0.0.1:4040/api/tunnels \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['tunnels'][0]['public_url'] if d.get('tunnels') else '')" \
  2>/dev/null || true)

echo ""
echo "==================================================="
echo "레디스     : 켜짐"
echo "백엔드     : http://127.0.0.1:8000  (로그: backend/logs/uvicorn.log)"
if [ -n "$NGROK_URL" ]; then
  echo "ngrok 주소 : $NGROK_URL"
  echo "            -> frontend/capacitor.config.ts의 server.url이랑 다르면 그것도 맞춰줘야 함"
else
  echo "ngrok 주소 : 아직 못 읽어옴 — 몇 초 뒤 http://127.0.0.1:4040 에서 직접 확인"
fi
echo "프론트엔드 : VS Code에서 그대로 켜면 됨 (이 스크립트 대상 아님)"
echo "==================================================="
