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
