"""
Supabase 로그인(JWT) 검증 (ROADMAP 5-2, 2026-10-07).

로그인은 선택 기능 — 기존 session_id 기반 흐름은 그대로 두고, 로그인한 요청에서만
"Authorization: Bearer <access_token>" 헤더가 추가로 들어옴. 그래서 여기 함수들은
토큰이 없거나 검증에 실패해도 예외를 던지지 않고 None을 반환해서, 호출하는 쪽(main.py)이
"비로그인으로 취급하고 계속 진행"할지 "이 엔드포인트는 로그인 필수라 401"로 할지 직접 정하게 함.

검증 방식(JWKS, 공개키 기반): 이 프로젝트의 Supabase JWT 서명 키가 ECC(P-256, ES256)
비대칭키라서(2026-10-07 대시보드에서 확인), 과거 방식(HS256 공유 비밀값)처럼 백엔드에
비밀값을 저장할 필요가 없음 — Supabase가 공개하는 JWKS 엔드포인트에서 검증용 공개키를
가져와 서명만 확인하면 됨. PyJWKClient가 이 공개키를 내부적으로 캐싱해줘서 매 요청마다
네트워크 호출이 일어나지 않음.
"""

import os
from typing import Optional

import jwt
from jwt import PyJWKClient

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
_JWKS_URL = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json" if SUPABASE_URL else None

# PyJWKClient가 없으면(SUPABASE_URL 미설정) 검증 자체를 건너뛰고 항상 비로그인으로 처리—
# 로그인이 선택 기능이라 이 설정이 비어있어도 서비스 전체가 죽으면 안 됨.
_jwks_client: Optional[PyJWKClient] = PyJWKClient(_JWKS_URL) if _JWKS_URL else None


def get_user_id_from_auth_header(authorization: Optional[str]) -> Optional[str]:
    """
    "Authorization: Bearer <jwt>" 헤더를 검증해서 Supabase user UUID(sub claim)를 반환.
    헤더가 없거나, 형식이 틀리거나, 서명/만료 검증에 실패하면 전부 None — 호출하는 쪽에서
    "로그인 안 한 것"과 동일하게 다루면 됨(예외를 일부러 삼킴, 선택적 인증이라서).
    """
    if not authorization or not _jwks_client:
        return None
    if not authorization.lower().startswith("bearer "):
        return None
    token = authorization[7:].strip()
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256"],
            audience="authenticated",
        )
        return payload.get("sub")
    except Exception as e:
        print(f"[auth] JWT 검증 실패(비로그인으로 취급): {e}")
        return None


def get_user_from_auth_header(authorization: Optional[str]) -> Optional[dict]:
    """/auth/me처럼 UUID 외에 이메일도 같이 보여주고 싶을 때 쓰는 확장판."""
    if not authorization or not _jwks_client:
        return None
    if not authorization.lower().startswith("bearer "):
        return None
    token = authorization[7:].strip()
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256"],
            audience="authenticated",
        )
        return {"user_id": payload.get("sub"), "email": payload.get("email")}
    except Exception as e:
        print(f"[auth] JWT 검증 실패(비로그인으로 취급): {e}")
        return None
