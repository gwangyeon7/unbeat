"""
외부 데이터 소스 연동: Open-Meteo 날씨 API.

회원가입/API 키가 필요 없는 무료 공개 API라서 별도 인증 없이 바로 호출 가능.
raw_events에 있는 이벤트 기간(최소~최대 날짜)에 맞춰 서울 지역 일별 날씨를
가져와서 DuckDB에 weather_daily 테이블로 적재한다.

이렇게 외부 데이터(날씨)를 서비스 자체 데이터(이벤트)랑 같은 웨어하우스에
모아두면, "비 오는 날엔 검색을 더/덜 하나?" 같은 분석을 SQL JOIN 하나로 할 수 있다.

실행: python fetch_weather.py
"""

import os
from datetime import date, timedelta

import duckdb
import pandas as pd
import requests

DUCKDB_PATH = os.path.join(os.path.dirname(__file__), "unbeat.duckdb")

# 서울 좌표. 도시를 바꾸고 싶으면 이 값만 바꾸면 됨.
LATITUDE = 37.5665
LONGITUDE = 126.9780

OPEN_METEO_URL = "https://archive-api.open-meteo.com/v1/archive"


def get_event_date_range():
    con = duckdb.connect(DUCKDB_PATH, read_only=True)
    try:
        min_date, max_date = con.execute(
            "SELECT MIN(CAST(created_at AS DATE)), MAX(CAST(created_at AS DATE)) FROM raw_events"
        ).fetchone()
    finally:
        con.close()
    return min_date, max_date


def fetch_weather(start_date, end_date) -> pd.DataFrame:
    params = {
        "latitude": LATITUDE,
        "longitude": LONGITUDE,
        "start_date": str(start_date),
        "end_date": str(end_date),
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum",
        "timezone": "Asia/Seoul",
    }
    res = requests.get(OPEN_METEO_URL, params=params, timeout=10)
    res.raise_for_status()
    data = res.json()["daily"]

    return pd.DataFrame({
        "date": pd.to_datetime(data["time"]).date,
        "temp_max": data["temperature_2m_max"],
        "temp_min": data["temperature_2m_min"],
        "precipitation_mm": data["precipitation_sum"],
    })


def load_into_duckdb(df: pd.DataFrame):
    con = duckdb.connect(DUCKDB_PATH)
    try:
        con.execute("CREATE OR REPLACE TABLE weather_daily AS SELECT * FROM df")
        count = con.execute("SELECT COUNT(*) FROM weather_daily").fetchone()[0]
        print(f"weather_daily 적재 완료: {count}일치")
    finally:
        con.close()


def main():
    min_date, max_date = get_event_date_range()
    if min_date is None:
        print("raw_events가 비어있어요. etl_load.py를 먼저 실행하세요.")
        return

    # Open-Meteo의 과거 날씨(archive) API는 최근 5일 정도는 아직 확정 데이터가 없어서
    # 너무 최근이거나 미래 날짜를 요청하면 400 에러가 남 -> 안전하게 클램핑
    safe_cutoff = date.today() - timedelta(days=6)
    if max_date > safe_cutoff:
        print(f"이벤트 최대 날짜({max_date})가 너무 최근이라 {safe_cutoff}까지로 조정해요.")
        max_date = safe_cutoff
    if min_date > max_date:
        print("가져올 수 있는 날씨 데이터 범위가 없어요 (전부 너무 최근 날짜).")
        return

    print(f"이벤트 기간: {min_date} ~ {max_date} 날씨 가져오는 중...")
    df = fetch_weather(min_date, max_date)
    load_into_duckdb(df)


if __name__ == "__main__":
    main()
