import json
import os

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
