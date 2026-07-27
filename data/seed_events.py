"""
합성(가짜) 이벤트 시드 스크립트.

실제 서비스 트래픽이 아직 없어서 AARRR/퍼널/코호트 분석을 해볼 만한 데이터가 없다.
그래서 여러 "세션(익명 사용자)"이 몇 주에 걸쳐 서비스에 들어왔다 나갔다 하는
현실적인 리텐션 곡선을 흉내내서 MariaDB events 테이블에 직접 데이터를 채운다.

리텐션 가정: 가입 주(week 0)는 100% 활동, 이후 주차마다 돌아올 확률이 감소.
퍼널 가정: search 이벤트 이후 일정 확률로 recommend_click이 뒤따름.

실행: python seed_events.py
"""

import os
import random
import uuid
from datetime import datetime, timedelta

import pymysql
from dotenv import load_dotenv

load_dotenv()

DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("DB_PORT", "3306"))
DB_USER = os.getenv("DB_USER", "unbeat")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_NAME = os.getenv("DB_NAME", "unbeat")

NUM_SESSIONS = 150
NUM_WEEKS = 8  # 코호트 주차 수

# 주차별 리텐션 확률 (0주차는 가입 주라 항상 활동함, 인덱스 1부터가 실제 "돌아올 확률")
RETENTION_CURVE = [1.0, 0.45, 0.32, 0.24, 0.19, 0.15, 0.12, 0.10]

ARTISTS = [
    "아이유", "IU", "뉴진스", "아이브", "르세라핌", "에스파", "세븐틴",
    "방탄소년단", "블랙핑크", "데이식스", "잔나비", "다비치", "윤하",
    "헤이즈", "볼빨간사춘기", "적재", "폴킴", "성시경", "colde", "sokodomo",
]

CLICK_THROUGH_RATE = 0.55  # search 이후 recommend_click으로 이어질 확률


def week_start(weeks_ago: int, now: datetime) -> datetime:
    """지금으로부터 weeks_ago주 전, 그 주의 월요일 자정"""
    this_monday = now - timedelta(days=now.weekday())
    this_monday = this_monday.replace(hour=0, minute=0, second=0, microsecond=0)
    return this_monday - timedelta(weeks=weeks_ago)


def random_timestamp_in_week(week_monday: datetime) -> datetime:
    day_offset = random.randint(0, 6)
    hour = random.randint(9, 23)
    minute = random.randint(0, 59)
    return week_monday + timedelta(days=day_offset, hours=hour, minutes=minute)


def generate_events_for_session(session_id: str, signup_week_idx: int, now: datetime):
    """signup_week_idx: 0 = 이번 주에 가입, NUM_WEEKS-1 = 가장 오래된 코호트"""
    events = []

    for weeks_since_signup in range(0, signup_week_idx + 1):
        retention_idx = weeks_since_signup
        if retention_idx >= len(RETENTION_CURVE):
            retention_idx = len(RETENTION_CURVE) - 1

        is_active = weeks_since_signup == 0 or random.random() < RETENTION_CURVE[retention_idx]
        if not is_active:
            continue

        weeks_ago = signup_week_idx - weeks_since_signup
        active_week_monday = week_start(weeks_ago, now)

        active_days = random.randint(1, 3)
        for _ in range(active_days):
            ts = random_timestamp_in_week(active_week_monday)
            num_searches = random.randint(1, 4)
            for _ in range(num_searches):
                artist = random.choice(ARTISTS)
                events.append((session_id, "search", artist, random.randint(1, 5), ts))
                if random.random() < CLICK_THROUGH_RATE:
                    click_ts = ts + timedelta(seconds=random.randint(5, 120))
                    events.append((session_id, "recommend_click", artist, random.randint(5, 15), click_ts))

    return events


def main():
    now = datetime.now()
    all_events = []

    for _ in range(NUM_SESSIONS):
        session_id = str(uuid.uuid4())
        signup_week_idx = random.randint(0, NUM_WEEKS - 1)
        all_events.extend(generate_events_for_session(session_id, signup_week_idx, now))

    print(f"생성된 이벤트 수: {len(all_events)}건, 세션 수: {NUM_SESSIONS}개")

    conn = pymysql.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASSWORD,
        database=DB_NAME,
        charset="utf8mb4",
        autocommit=True,
    )
    try:
        with conn.cursor() as cursor:
            cursor.executemany(
                """
                INSERT INTO events (session_id, event_type, artist_name, result_count, created_at)
                VALUES (%s, %s, %s, %s, %s)
                """,
                all_events,
            )
        print("MariaDB events 테이블에 적재 완료")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
