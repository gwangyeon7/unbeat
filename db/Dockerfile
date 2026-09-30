# Render용 MariaDB 이미지 — 공식 mariadb 이미지에 schema.sql만 얹음.
#
# 공식 mariadb 이미지는 컨테이너를 "처음" 띄울 때(데이터 디렉터리가 비어있을 때) 딱 한 번,
# /docker-entrypoint-initdb.d/ 안의 .sql 파일을 자동으로 실행해준다 — 그래서 별도 초기화
# 스크립트 없이 schema.sql만 그 경로에 복사해두면 됨.
#
# backend/schema.sql을 그대로 재사용(중복 관리 방지) — 이 Dockerfile의 빌드 컨텍스트를
# 저장소 루트로 잡아야 이 상대 경로(backend/schema.sql)가 존재함
# (render.yaml에서 dockerContext를 지정 안 하면 기본값이 저장소 루트라 그대로 맞음).
FROM mariadb:11
COPY backend/schema.sql /docker-entrypoint-initdb.d/schema.sql
