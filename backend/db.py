import os
from contextlib import contextmanager

import pymysql
from pymysql.cursors import DictCursor

DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("DB_PORT", "3306"))
DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_NAME = os.getenv("DB_NAME", "unbeat")


@contextmanager
def get_connection():
    """요청마다 짧게 열고 닫는 커넥션. MVP 단계라 풀링은 나중에 최적화 대상으로 남겨둔다."""
    conn = pymysql.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME,
        charset="utf8mb4",
        cursorclass=DictCursor,
        autocommit=True,
    )
    try:
        yield conn
    finally:
        conn.close()


def log_event(session_id: str, event_type: str, artist_name: str, result_count: int = None):
    """events 테이블에 사용자 행동 이벤트 한 건 적재.

    분석 파이프라인(Phase 1 후반부)이 이 원본 이벤트를 DuckDB로 옮겨서
    AARRR/퍼널/코호트 분석에 쓸 예정이라, 여기서는 실패해도 API 응답에는
    영향을 주지 않도록 조용히 넘어간다 (로깅 실패가 서비스 장애로 번지면 안 됨).
    """
    try:
        with get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO events (session_id, event_type, artist_name, result_count)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (session_id, event_type, artist_name, result_count),
                )
    except Exception as e:
        print(f"[event-log] 이벤트 적재 실패 (무시하고 진행): {e}")


def get_lyrics_requests(limit: int = 100) -> list:
    """
    "가사 올려주세요" 버튼(§28)이 쌓아온 lyrics_request 이벤트를 곡 단위로 묶어서 가져옴.
    이 이벤트가 쌓이기만 하고 운영자가 확인/처리할 화면이 없어서(요청만 남기고 끝 —
    "계속 안 올라가면 안 되지 않냐"는 지적으로 이 함수와 /admin/lyrics-requests를 추가함),
    같은 곡이 여러 번 요청됐으면 몇 번 요청됐는지(request_count)까지 같이 세서 우선순위를
    가늠할 수 있게 함. artist_name 컬럼에 "아티스트 - 곡명" 형태로 저장돼 있어서(로깅 시점에
    합쳐 넣음) 여기서는 그룹핑까지만 하고, 아티스트/곡명 분리는 호출하는 쪽(main.py)에서 함.
    """
    try:
        with get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT artist_name, COUNT(*) AS request_count, MAX(created_at) AS last_requested_at
                    FROM events
                    WHERE event_type = 'lyrics_request'
                    GROUP BY artist_name
                    ORDER BY last_requested_at DESC
                    LIMIT %s
                    """,
                    (limit,),
                )
                return cursor.fetchall()
    except Exception as e:
        print(f"[lyrics-requests] 조회 실패 (빈 목록으로 대체): {e}")
        return []


def get_recent_searches(session_id: str, limit: int = 5) -> list:
    """이 세션이 최근 검색한 아티스트명을 최신순 중복 없이 가져옴.

    같은 아티스트를 여러 번 검색했으면 가장 최근 것만 남기기 위해
    아티스트별 최신 검색 시각으로 그룹핑한 뒤 정렬한다.

    (참고: 검색창 드롭다운 '최근 검색' UI는 이제 이 함수 대신 cache.py의
    Redis 기반 push/get_search_history를 씀 — 사용자가 항목을 지울 수 있어야 하는데
    이 events 테이블은 분석 원본 데이터라 임의로 지우면 안 되기 때문. 이 함수는 나중에
    "검색으로 들어온 세션의 실제 검색 패턴 분석" 같은 분석 목적으로 재사용할 수 있어서 남겨둠.)
    """
    try:
        with get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT artist_name, MAX(created_at) AS last_searched_at
                    FROM events
                    WHERE session_id = %s AND event_type = 'search'
                    GROUP BY artist_name
                    ORDER BY last_searched_at DESC
                    LIMIT %s
                    """,
                    (session_id, limit),
                )
                rows = cursor.fetchall()
                return [row["artist_name"] for row in rows]
    except Exception as e:
        print(f"[recent-searches] 조회 실패 (빈 목록으로 대체): {e}")
        return []
