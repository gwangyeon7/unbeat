import json
import os
from typing import Optional

import redis

REDIS_HOST = os.getenv("REDIS_HOST", "127.0.0.1")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_DB = int(os.getenv("REDIS_DB", "0"))

CACHE_TTL_SECONDS = 60 * 60  # 1시간. 아티스트 정보는 자주 안 바뀌니까 넉넉하게 잡음.

_client = redis.Redis(
    host=REDIS_HOST,
    port=REDIS_PORT,
    db=REDIS_DB,
    decode_responses=True,
    socket_connect_timeout=1,
)


def get_cached(key: str):
    """cache-aside 패턴의 '캐시 확인' 단계. Redis가 죽어있어도 서비스는 멈추면 안 되니 예외를 삼킴."""
    try:
        raw = _client.get(key)
    except redis.RedisError as e:
        print(f"[cache] Redis 조회 실패 (캐시 없이 진행): {e}")
        return None
    if raw is None:
        return None
    return json.loads(raw)


def set_cached(key: str, value, ttl: int = CACHE_TTL_SECONDS):
    """cache-aside 패턴의 '캐시 저장' 단계."""
    try:
        _client.set(key, json.dumps(value, ensure_ascii=False), ex=ttl)
    except redis.RedisError as e:
        print(f"[cache] Redis 저장 실패 (무시하고 진행): {e}")


def delete_cached(key: str):
    """가사 저작권 요청 삭제(takedown)처럼, TTL이 다 될 때까지 기다리지 않고 즉시 캐시를
    지워야 하는 경우용. Redis가 죽어있어도 예외를 삼켜서 서비스가 멈추지 않게 함."""
    try:
        _client.delete(key)
    except redis.RedisError as e:
        print(f"[cache] Redis 삭제 실패 (무시하고 진행): {e}")


RECENT_SEARCH_LIMIT = 10
RECENT_SEARCH_TTL_SECONDS = 60 * 60 * 24 * 30  # 30일


def push_search_history(session_id: str, query: str, image: Optional[str] = None):
    """
    검색창 드롭다운에 쓸 '최근 검색' 목록. 분석용 이벤트 로그(MariaDB events 테이블)와는
    의도적으로 분리해서 Redis 리스트에 세션별로 저장함 — 사용자가 드롭다운에서 삭제 버튼을
    누르면 이 목록에서만 지워지고, AARRR/코호트 분석에 쓰는 원본 이벤트 데이터는 그대로
    남아야 하기 때문(사용자 편의 기능과 분석 원본 데이터를 같은 저장소에 두면 안 됨).

    (버그 아님, UI 재구조화 2026-10-14) 원래는 검색어(문자열) 하나만 저장했는데, "최근 검색어가
    유튜브 뮤직처럼 앨범 썸네일 카드로 보였으면 좋겠다"는 요청으로 각 항목에 썸네일 이미지도
    같이 저장하도록 바꿈 — 그래서 리스트 원소가 plain string이 아니라 {"query", "image"} JSON이
    됨. 호출부(main.py)가 그 검색의 첫 번째 트랙/아티스트 이미지를 넘겨줌(없으면 None).
    """
    key = f"recent-searches:{session_id}"
    entry = json.dumps({"query": query, "image": image}, ensure_ascii=False)
    try:
        # 이미 있던 같은 검색어는 지우고 맨 앞에 다시 넣어서 "최신순 + 중복 없음" 유지.
        # 저장 형식이 JSON으로 바뀌어서 lrem(key, 0, query)로 직접 매치가 안 되니, 기존 목록을
        # 읽어와 query가 같은 항목만 걸러내고 다시 쓰는 방식으로 변경.
        raw_list = _client.lrange(key, 0, -1)
        remaining = [r for r in raw_list if json.loads(r).get("query") != query]
        if len(remaining) != len(raw_list):
            _client.delete(key)
            if remaining:
                _client.rpush(key, *remaining)
        _client.lpush(key, entry)
        _client.ltrim(key, 0, RECENT_SEARCH_LIMIT - 1)
        _client.expire(key, RECENT_SEARCH_TTL_SECONDS)
    except redis.RedisError as e:
        print(f"[cache] 최근 검색 저장 실패 (무시하고 진행): {e}")


def get_search_history(session_id: str) -> list:
    """반환 형식이 문자열 목록에서 {"query", "image"} 객체 목록으로 바뀜(위 push_search_history
    참고) — 과거(마이그레이션 전)에 plain string으로 저장된 값이 TTL 만료 전까지 섞여 있을 수
    있어서, JSON 파싱이 안 되는 옛 항목은 image 없는 객체로 방어적으로 변환해서 내려줌."""
    key = f"recent-searches:{session_id}"
    try:
        raw_list = _client.lrange(key, 0, RECENT_SEARCH_LIMIT - 1)
    except redis.RedisError as e:
        print(f"[cache] 최근 검색 조회 실패 (빈 목록으로 대체): {e}")
        return []
    result = []
    for r in raw_list:
        try:
            parsed = json.loads(r)
            if isinstance(parsed, dict) and "query" in parsed:
                result.append(parsed)
            else:
                result.append({"query": str(parsed), "image": None})
        except (json.JSONDecodeError, TypeError):
            result.append({"query": r, "image": None})  # 마이그레이션 전 plain string 항목
    return result


def remove_search_history(session_id: str, query: str):
    key = f"recent-searches:{session_id}"
    try:
        raw_list = _client.lrange(key, 0, -1)
        remaining = [r for r in raw_list if json.loads(r).get("query") != query]
        if len(remaining) != len(raw_list):
            _client.delete(key)
            if remaining:
                _client.rpush(key, *remaining)
    except (redis.RedisError, json.JSONDecodeError, TypeError) as e:
        print(f"[cache] 최근 검색 삭제 실패 (무시하고 진행): {e}")


RECENT_PLAYS_LIMIT = 20
RECENT_PLAYS_TTL_SECONDS = 60 * 60 * 24 * 90  # 90일 — 즐겨찾기보다 짧게, 오래 방문 안 하면 자연 소멸


def _is_same_track(entry: dict, artist: str, name: str) -> bool:
    return (
        entry.get("artist", "").lower().strip() == artist.lower().strip()
        and entry.get("name", "").lower().strip() == name.lower().strip()
    )


def push_recent_play(session_id: str, artist: str, name: str, url=None, image=None):
    """
    "다시 듣기" 홈 섹션용 최근 재생 기록. 원래 이 섹션은 즐겨찾기 목록을 그대로 재사용해서
    보여줬는데, "즐겨찾기는 사이드바에 이미 따로 있는데 다시 듣기도 즐겨찾기를 보여주면
    중복 아니냐"는 지적을 받고 진짜 "최근에 재생 시작한 곡" 기록으로 바꿈. 분석용 이벤트 로그
    (MariaDB, play_track 이벤트)를 그대로 조회하지 않고 최근 검색(push_search_history)과
    같은 패턴으로 Redis에 세션별 목록을 따로 둔 이유도 동일 — 실시간 UI 조회용 데이터와
    배치/분석용 원본 로그를 같은 저장소에 두지 않는다는 이 프로젝트의 일관된 원칙.
    """
    key = f"recent-plays:{session_id}"
    entry = {"artist": artist, "name": name, "url": url, "image": image}
    try:
        raw_list = _client.lrange(key, 0, -1)
        remaining = [r for r in raw_list if not _is_same_track(json.loads(r), artist, name)]
        if len(remaining) != len(raw_list):
            _client.delete(key)
            if remaining:
                _client.rpush(key, *remaining)
        _client.lpush(key, json.dumps(entry, ensure_ascii=False))
        _client.ltrim(key, 0, RECENT_PLAYS_LIMIT - 1)
        _client.expire(key, RECENT_PLAYS_TTL_SECONDS)
    except redis.RedisError as e:
        print(f"[cache] 최근 재생 기록 실패 (무시하고 진행): {e}")


def get_recent_plays(session_id: str) -> list:
    key = f"recent-plays:{session_id}"
    try:
        raw_list = _client.lrange(key, 0, RECENT_PLAYS_LIMIT - 1)
        return [json.loads(r) for r in raw_list]
    except redis.RedisError as e:
        print(f"[cache] 최근 재생 조회 실패 (빈 목록으로 대체): {e}")
        return []


# "다음 트랙" 수작업 매핑(§82 이후, 외부 API 없이 운영자가 직접 등록) 인덱스.
# 매핑 자체는 next-track-override:{artist}:{track} 키 각각에 저장되는데, Redis는 "이 패턴에
# 맞는 키 전부"를 가볍게 조회하는 기능이 없어서(KEYS 명령은 운영 중 전체 스캔이라 피해야 함),
# 관리자 페이지에서 "지금까지 등록한 매핑 목록"을 보여주려면 어떤 (아티스트, 곡명) 쌍에 매핑이
# 있는지 따로 추적해둬야 함 — 그래서 Set 하나에 그 쌍들만 모아둠(가사 요청 큐와 달리, 이건
# "사용자 요청"이 아니라 운영자가 능동적으로 등록하는 거라 MariaDB 쪽엔 로그가 없음).
NEXT_TRACK_OVERRIDE_INDEX_KEY = "next-track-override-index"


def _override_index_member(artist: str, track: str) -> str:
    return json.dumps({"artist": artist, "track": track}, ensure_ascii=False)


def add_next_track_override_index(artist: str, track: str):
    try:
        _client.sadd(NEXT_TRACK_OVERRIDE_INDEX_KEY, _override_index_member(artist, track))
    except redis.RedisError as e:
        print(f"[cache] 다음 트랙 override 인덱스 추가 실패 (무시하고 진행): {e}")


def remove_next_track_override_index(artist: str, track: str):
    try:
        _client.srem(NEXT_TRACK_OVERRIDE_INDEX_KEY, _override_index_member(artist, track))
    except redis.RedisError as e:
        print(f"[cache] 다음 트랙 override 인덱스 삭제 실패 (무시하고 진행): {e}")


def list_next_track_overrides() -> list:
    try:
        raw = _client.smembers(NEXT_TRACK_OVERRIDE_INDEX_KEY)
        return [json.loads(r) for r in raw]
    except redis.RedisError as e:
        print(f"[cache] 다음 트랙 override 인덱스 조회 실패 (빈 목록으로 대체): {e}")
        return []
