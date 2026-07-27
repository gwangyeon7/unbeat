"""
MariaDB(OLTP) -> DuckDB(OLAP) 적재 스크립트.

서비스용 트랜잭션 DB(MariaDB)에서 이벤트 원본을 그대로 읽어서
분석 전용 DuckDB 파일(unbeat.duckdb)의 raw_events 테이블로 복사한다.
분석 쿼리는 절대 MariaDB에 직접 붙지 않고 이 DuckDB 파일 위에서만 돈다
(운영 DB에 무거운 분석 쿼리가 부하를 주지 않도록 분리하는 게 목적).

실행: python etl_load.py
"""

import os

import duckdb
import pandas as pd
import pymysql
from dotenv import load_dotenv

load_dotenv()

DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("DB_PORT", "3306"))
DB_USER = os.getenv("DB_USER", "unbeat")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_NAME = os.getenv("DB_NAME", "unbeat")

DUCKDB_PATH = os.path.join(os.path.dirname(__file__), "unbeat.duckdb")


def extract_events_from_mariadb() -> pd.DataFrame:
    conn = pymysql.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME,
        charset="utf8mb4",
    )
    try:
        df = pd.read_sql("SELECT * FROM events", conn)
    finally:
        conn.close()
    return df


def load_into_duckdb(df: pd.DataFrame):
    con = duckdb.connect(DUCKDB_PATH)
    try:
        # df 변수를 SQL에서 바로 테이블처럼 참조할 수 있는 게 DuckDB의 파이썬 연동 특징
        con.execute("CREATE OR REPLACE TABLE raw_events AS SELECT * FROM df")
        count = con.execute("SELECT COUNT(*) FROM raw_events").fetchone()[0]
        min_date, max_date = con.execute(
            "SELECT MIN(created_at), MAX(created_at) FROM raw_events"
        ).fetchone()
        print(f"raw_events 적재 완료: {count}건 ({min_date} ~ {max_date})")
    finally:
        con.close()


def main():
    df = extract_events_from_mariadb()
    if df.empty:
        print("events 테이블이 비어있어요. seed_events.py를 먼저 실행하거나 서비스에서 검색을 해보세요.")
        return
    load_into_duckdb(df)


if __name__ == "__main__":
    main()
