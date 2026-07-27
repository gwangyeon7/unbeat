from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from typing import Optional
import requests
import os

load_dotenv()  # db 모듈이 환경변수를 읽기 전에 먼저 .env를 로드해야 함

from db import log_event
from cache import get_cached, set_cached


class UTF8JSONResponse(JSONResponse):
    # FastAPI 기본 JSONResponse는 Content-Type에 charset을 안 붙여서
    # 브라우저가 직접 API 주소로 들어갔을 때 한글을 잘못된 인코딩으로 표시하는 문제가 있음 -> 명시적으로 고정
    media_type = "application/json; charset=utf-8"


app = FastAPI(default_response_class=UTF8JSONResponse)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

LASTFM_API_KEY = os.getenv("LASTFM_API_KEY")
LASTFM_BASE_URL = "https://ws.audioscrobbler.com/2.0/"


def lastfm_get(params: dict):
    """Last.fm API 공통 호출 헬퍼. OAuth 없이 api_key만 있으면 read 메서드 사용 가능."""
    params = {
        **params,
        "api_key": LASTFM_API_KEY,
        "format": "json",
    }
    res = requests.get(LASTFM_BASE_URL, params=params)
    if res.status_code != 200:
        raise HTTPException(status_code=res.status_code, detail="Last.fm API 요청 실패")
    # Last.fm 응답이 charset을 안 알려줘서 requests가 인코딩을 잘못 추측하는 경우가 있음 -> UTF-8로 고정
    res.encoding = "utf-8"
    data = res.json()
    if "error" in data:
        raise HTTPException(status_code=400, detail=data.get("message", "Last.fm API 오류"))
    return data


def best_image(images: list) -> Optional[str]:
    """Last.fm 이미지 배열에서 가장 큰 이미지를 골라 반환. 빈 값이 많아 안전하게 처리."""
    if not images:
        return None
    for img in reversed(images):
        url = img.get("#text")
        if url:
            return url
    return None


@app.get("/")
def root():
    return {"message": "Unbeat API 실행 중 (Last.fm 기반)"}


@app.get("/search-artist")
def search_artist(artist_name: str, x_session_id: Optional[str] = Header(default=None)):
    cache_key = f"search-artist:{artist_name.lower().strip()}"
    cached = get_cached(cache_key)
    if cached is not None:
        if x_session_id:
            log_event(x_session_id, "search", artist_name, result_count=len(cached["artists"]))
        return {**cached, "cached": True}

    data = lastfm_get({
        "method": "artist.search",
        "artist": artist_name,
        "limit": 5,
    })
    matches = data.get("results", {}).get("artistmatches", {}).get("artist", [])
    artists = [
        {
            "name": item["name"],
            "mbid": item.get("mbid"),
            "image": best_image(item.get("image", [])),
            "listeners": item.get("listeners"),
        }
        for item in matches
    ]

    result = {"artists": artists}
    set_cached(cache_key, result)

    if x_session_id:
        log_event(x_session_id, "search", artist_name, result_count=len(artists))

    return {**result, "cached": False}


@app.get("/recommend")
def recommend_by_artist(artist_name: str, x_session_id: Optional[str] = Header(default=None)):
    cache_key = f"recommend:{artist_name.lower().strip()}"
    cached = get_cached(cache_key)
    if cached is not None:
        if x_session_id:
            log_event(x_session_id, "recommend_click", artist_name, result_count=len(cached["tracks"]))
        return {**cached, "cached": True}

    similar = lastfm_get({
        "method": "artist.getSimilar",
        "artist": artist_name,
        "limit": 5,
    })
    related_artists = similar.get("similarartists", {}).get("artist", [])

    tracks = []
    for artist in related_artists:
        top_tracks = lastfm_get({
            "method": "artist.getTopTracks",
            "artist": artist["name"],
            "limit": 3,
        })
        track_list = top_tracks.get("toptracks", {}).get("track", [])
        for track in track_list:
            tracks.append({
                "name": track["name"],
                "artist": track["artist"]["name"],
                "listeners": track.get("listeners"),
                "url": track.get("url"),
            })

    result = {"tracks": tracks}
    set_cached(cache_key, result)

    if x_session_id:
        log_event(x_session_id, "recommend_click", artist_name, result_count=len(tracks))

    return {**result, "cached": False}
