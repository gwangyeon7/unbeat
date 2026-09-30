# unbeat FastAPI 백엔드 배포용 이미지.
#
# python:3.10-slim을 쓰는 이유: requirements.txt에 있는 .pyc 캐시 파일이
# cpython-310으로 컴파일돼 있어서(로컬 개발 환경이 3.10) 버전을 맞춰야 함.
#
# git/build-essential을 까는 이유: requirements.txt의 PyKoSpacing이
# `git+https://...` 형태(VCS 설치)라 pip이 내부적으로 git 명령을 호출함.
FROM python:3.10-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# requirements만 먼저 복사해서 캐싱 — 코드만 바뀌고 의존성이 그대로면
# (TensorFlow 포함이라 설치가 오래 걸림) 재배포 때 이 레이어를 재사용함.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Render는 컨테이너가 리슨할 포트를 PORT 환경변수로 주입함(고정 불가).
# 로컬에서 `docker run`으로 테스트할 땐 PORT를 안 주니 8000을 기본값으로 둠.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
