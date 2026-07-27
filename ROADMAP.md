# Unbeat 풀스택 포트폴리오 로드맵

## 목표
- 1순위 타겟: 페이타랩 (데이터 엔지니어링)
- 2순위: 바디코디, 드림어스, 포스타입, 러쉬에잇, 디자이노블 등 백엔드/풀스택 공고
- 투자 기간: 3개월 이상
- 언어 우선순위: Python 심화 → Kotlin/Spring Boot → TypeScript/NestJS → 인프라 마무리
- AI Agent/LLM 자체 개발(RAG, MCP 등)은 이번 로드맵에서 제외, 추후 확장 옵션으로만 남겨둠

## 프로젝트 개요
Unbeat: Spotify API 기반으로 새로운 음악을 찾아주는 서비스.
현재 상태: FastAPI 백엔드(main.py, 검색/추천/로그인) 존재, 프론트엔드는 미착수.

---

## Phase 1. Python 심화 (4~5주)
**타겟 공고:** 페이타랩, 디자이노블

- [x] 프론트엔드 신규 구축 (Next.js + TypeScript) — 검색, 추천 UI (Last.fm은 OAuth 불필요해서 로그인은 스킵)
- [x] 이벤트 로깅 추가 (검색/추천클릭 이벤트, MariaDB `unbeat.events` 테이블에 적재, 익명 session_id로 사용자 구분)
- [x] MySQL 또는 PostgreSQL에 원본 데이터 적재 (MariaDB `unbeat.events`에 search/recommend_click 이벤트 적재 확인)
- [x] DuckDB로 분석 웨어하우스 구축 (Snowflake 대체) — `data/etl_load.py`로 MariaDB -> DuckDB 적재 확인
- [x] dbt-duckdb로 변환 레이어 구성 (staging → mart), 데이터 품질 테스트 — `dbt run`/`dbt test` 실행 확인, 테스트 13개 전부 통과
- [x] AARRR / 퍼널 / 코호트 분석 (SQL 기반) — 검색→클릭 전환율, 주간 코호트 리텐션 확인
- [ ] Redis로 추천 결과 캐싱
- [ ] 외부 데이터 소스 1개 추가 연동 (날씨 API 또는 공휴일 API)

---

## Phase 2. Kotlin / Spring Boot (3~4주)
**타겟 공고:** 바디코디, 드림어스, 포스타입

- [ ] "플레이리스트/즐겨찾기" 도메인을 별도 서비스로 분리 (Spring Boot + JPA + MySQL)
- [ ] Spring Batch로 정기 배치 구현 (예: 주간 추천 갱신)
- [ ] 구독/프리미엄 결제 모의 플로우 추가 (바디코디의 결제/정산 도메인 커버)
- [ ] JUnit 기반 테스트 코드 작성
- [ ] 코드 리뷰 컨벤션 정리 (ktlint/checkstyle), 리팩터링 1회 이상 기록

---

## Phase 3. TypeScript / NestJS (2~3주)
**타겟 공고:** 러쉬에잇, 일본 이커머스 포지션

- [ ] 알림 서비스 분리 (NestJS, 신곡 알림 등)
- [ ] SQS/SNS를 LocalStack으로 흉내내어 이벤트 기반 아키텍처 구현
- [ ] PostgreSQL 또는 MongoDB 중 하나로 NoSQL/RDBMS 다양성 확보

---

## Phase 4. 인프라 / 운영 마무리 (2~3주)
**타겟 공고:** 러쉬에잇, 포스타입, 바디코디 (공통)

- [ ] Docker Compose로 전체 서비스 오케스트레이션
- [ ] GitHub Actions CI/CD 파이프라인 구축
- [ ] Terraform으로 AWS 리소스 일부 IaC화 (선택)
- [ ] Prometheus + Grafana (또는 CloudWatch)로 모니터링 환경 구축
- [ ] 장애 대응/재발 방지 문서 1건 작성 (가상 장애 시나리오 기반)
- [ ] Metabase 등으로 AARRR 대시보드 시각화 (BI 툴 경험)

---

## 보류 (추후 확장 옵션)
- MCP 기반 자연어 음악 추천 에이전트 (Tool calling, 멀티스텝 추론)
  - 제조업 AI Agent 공고, 디자이노블 LLM 우대사항 대응용으로 나중에 고려

---

## 채용공고 ↔ 스킬 매핑

| 회사 | 핵심 스택 | Unbeat에서 커버하는 부분 |
|---|---|---|
| 페이타랩 | Python, SQL, Snowflake/DW, dbt, AARRR | Phase 1 전체 |
| 디자이노블 | Python/TS, REST API, Git, AI 도구 활용 | Phase 1 + 전체 개발 과정(Claude 활용) |
| 바디코디 | Java/Kotlin, Spring Boot, Spring Batch, MySQL, Redis, SQS/SNS | Phase 2 |
| 드림어스 | Java/Kotlin/Go, REST API, RDBMS/SQL | Phase 2 |
| 포스타입 | Spring(Boot/Batch), JPA, AWS 전반 | Phase 2 + Phase 4 |
| 러쉬에잇 | TypeScript, NestJS, PostgreSQL/MongoDB, Docker/K8s, Terraform, CI/CD, BI툴 | Phase 3 + Phase 4 |
| 일본 이커머스 포지션 | TS/Node/Python, PostgreSQL/Redis/DynamoDB, 결제(KOMOJU/PayVerse) | Phase 2(결제) + Phase 3 |

---

## 낮은 우선순위 (스킵)
- PHP / Classic ASP / MSSQL — 공고 1건, 레거시 스택으로 학습 우선순위 낮음
