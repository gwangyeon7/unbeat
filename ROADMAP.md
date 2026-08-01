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
- [x] Redis로 추천 결과 캐싱 — 브라우저에서 cached:false -> cached:true 전환 실제 확인
- [x] 외부 데이터 소스 1개 추가 연동 (Open-Meteo 날씨 API, 키 불필요) — weather_daily 테이블 적재 + 검색량 상관관계 분석까지 확인
- [x] 홈 화면 무드 탐색 (검색 없이 태그 기반 곡 추천) — `/discover-by-mood` 신규 엔드포인트(Last.fm `tag.getTopTracks`, cache-aside + `mood_browse` 이벤트 로깅), 프론트 무드 칩 UI. "운동" 칩 클릭 시 검색 없이 곡 목록 뜨는 것 실제 확인 (본인의 실제 유튜브 뮤직 사용 패턴 피드백 반영)
- [x] 홈 화면 사이드바 (최근 검색 / 즐겨찾기 태그 요약) — 기존 이벤트 로그·즐겨찾기 데이터를 재활용해 새 위젯 2개 추가. 카드 스타일 통일 실제 확인
- [x] 통합 검색(아티스트+곡) + 한글 오타 교정 — `GET /search`가 `artist.search`+`track.search` 동시 호출, `rapidfuzz`로 한글 아티스트명 후보 목록 기반 오타 교정(영문은 Last.fm `artist.getCorrection`). "아이위" 검색 시 "아이유"로 교정되어 정상 결과 뜨는 것 실제 확인 (중간에 Redis 캐시 때문에 반영 안 되는 것처럼 보였던 이슈 해결 후)

---

## Phase 2. Kotlin / Spring Boot (3~4주)
**타겟 공고:** 바디코디, 드림어스, 포스타입

- [x] "플레이리스트/즐겨찾기" 도메인을 별도 서비스로 분리 (Spring Boot + JPA + MySQL) — 별표 클릭→즐겨찾기 저장→새로고침해도 유지 실제 확인
- [x] 즐겨찾기를 트랙(곡) 단위로 확장 + Last.fm 태그(`track.getTopTags`) 자동 수집·저장 — 서구 유명곡(BRITPOP 등)은 태그 정상 수집 확인, 대신 케이팝 트랙은 Last.fm 태그 데이터 자체가 거의 없다는 실제 한계 발견
- [x] 즐겨찾기 곡에 다중 태그 그룹핑 적용 (대표 태그 1개 → 가진 태그 전부) + 원곡 링크(`url`) 저장 — "다시 듣기" 목록에서 여러 태그 그룹에 동시에 뜨는 것, 링크 클릭되는 것 실제 확인
- [ ] Spring Batch로 정기 배치 구현: (1) 태그 기반으로 즐겨찾기 곡을 무드/장르별 자동 그룹핑, (2) N개월간 재생 이벤트 없는 곡을 "거의 안 듣는 곡" 그룹으로 자동 분류
  - **왜**: 본인이 겪는 실제 불편(장르는 다양한데 제목 기억은 못 함, 플레이리스트가 넣은 순서대로만 재생됨, 안 듣는 곡이 안 걸러짐)에서 나온 아이디어. Spotify/YouTube Music도 1단계는 태그·메타데이터 기반 분류 + 2단계로 오디오 분석/협업 필터링을 얹는데, Last.fm은 오디오 분석 API가 없고(Spotify도 2024년 말부터 신규 앱엔 막음) 태그만 제공하므로 여기선 태그+행동 데이터(재생 이력) 기반 규칙/배치 처리로 한정 — LLM/대화형 추천(보류 항목)과는 별개.
  - **진행 상황**: (2)의 입력 데이터가 될 "재생 의도 신호"(`FavoriteTrack.lastOpenedAt`, 곡 카드 클릭 시 갱신)는 먼저 만들어서 쌓고 있음 — 실제 배치 로직은 신호가 며칠 쌓인 뒤 착수 예정.
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
