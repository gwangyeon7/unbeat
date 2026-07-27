"""
DuckDB(unbeat.duckdb)에 적재된 raw_events 위에서 AARRR 관점의 퍼널/코호트 분석을 실행한다.
etl_load.py를 먼저 돌려서 raw_events 테이블이 채워져 있어야 한다.

실행: python run_analysis.py
"""

import os

import duckdb
import pandas as pd

DUCKDB_PATH = os.path.join(os.path.dirname(__file__), "unbeat.duckdb")
SQL_DIR = os.path.join(os.path.dirname(__file__), "sql")


def read_sql(filename: str) -> str:
    with open(os.path.join(SQL_DIR, filename), encoding="utf-8") as f:
        return f.read()


def run_funnel(con):
    print("\n=== 1) 전체 퍼널: 검색 -> 추천 클릭 전환율 ===")
    df = con.execute(read_sql("funnel.sql")).df()
    print(df.to_string(index=False))

    print("\n=== 2) 주차별 퍼널 추이 ===")
    df = con.execute(read_sql("funnel_weekly.sql")).df()
    print(df.to_string(index=False))


def run_cohort_retention(con):
    print("\n=== 3) 주간 코호트 리텐션 ===")
    raw = con.execute(read_sql("cohort_retention.sql")).df()

    if raw.empty:
        print("데이터 없음")
        return

    pivot = raw.pivot(index="cohort_week", columns="weeks_since_signup", values="active_sessions")

    # 각 코호트의 0주차(가입 주) 인원 대비 리텐션 %로 변환
    week0 = pivot[0]
    retention_pct = pivot.div(week0, axis=0).multiply(100).round(1)

    print("\n[코호트별 활성 세션 수 (원본)]")
    print(pivot.fillna("-").to_string())

    print("\n[코호트별 리텐션 % (0주차=100 기준)]")
    print(retention_pct.fillna("-").to_string())


def run_weather_correlation(con):
    print("\n=== 4) 외부 데이터(날씨) x 검색 활동 ===")
    tables = [t[0] for t in con.execute("SHOW TABLES").fetchall()]
    if "weather_daily" not in tables:
        print("weather_daily 테이블이 없어요. fetch_weather.py를 먼저 실행하세요.")
        return

    df = con.execute(read_sql("weather_vs_search.sql")).df()
    print(df.to_string(index=False))

    if len(df) > 2:
        corr = df["precipitation_mm"].corr(df["search_count"])
        print(f"\n강수량 vs 검색량 상관계수: {corr:.2f} (1에 가까울수록 같이 늘고, -1에 가까울수록 반대로 움직임)")


def main():
    con = duckdb.connect(DUCKDB_PATH, read_only=True)
    try:
        run_funnel(con)
        run_cohort_retention(con)
        run_weather_correlation(con)
    finally:
        con.close()


if __name__ == "__main__":
    main()
