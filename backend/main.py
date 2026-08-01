from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from typing import Optional
from rapidfuzz import process as fuzzy_process
import re
import requests
import os

# Last.fm의 artist.getCorrection은 영문 철자 간 편집 거리(edit distance) 기반이라
# 한글 입력("아이위" 등)엔 아예 안 맞음 — 한글 오타와 영문 정식명("아이위" ↔ "IU")은
# 글자 자체가 안 겹쳐서 전혀 엉뚱한 아티스트로 잘못 교정되는 걸 실제로 확인함.
# 대신 Last.fm은 한글 아티스트명 자체는(정확히 쓰면) 잘 찾아주므로("아이유" 검색은 정상 동작),
# 한글 오타는 자체 후보 목록에서 가장 비슷한 "정확한 한글 철자"를 찾아 그걸로 재검색하는 방식으로 처리.
HANGUL_PATTERN = re.compile(r"[가-힣]")

# 오타 교정 후보로 쓸 한글 아티스트명 목록. Last.fm getCorrection처럼 전체 데이터베이스를
# 다 아는 게 아니라 이 목록 안에서만 가장 비슷한 철자를 찾아줌 — 커버리지는 좁지만
# "완전히 엉뚱한 결과보다는 아예 못 찾는 게 낫다"는 원칙으로 스코프를 의도적으로 좁힘.
KNOWN_KOREAN_ARTIST_NAMES = [
    "아이유", "아이브", "뉴진스", "르세라핌", "에스파", "블랙핑크", "방탄소년단",
    "세븐틴", "스트레이 키즈", "트와이스", "레드벨벳", "있지", "여자아이들",
    "엔하이픈", "투모로우바이투게더", "제니", "리사", "로제", "지수",
    "뉴이스트", "몬스타엑스", "갓세븐", "아이콘", "위너", "빅뱅", "샤이니",
    "슈퍼주니어", "동방신기", "소녀시대", "에이핑크", "다비치", "볼빨간사춘기",
    "악동뮤지션", "적재", "폴킴", "헤이즈", "크러쉬", "딘", "자이언티",
    "정은지", "양요섭", "허각", "임영웅", "청하", "선미", "화사",
]

load_dotenv()  # db 모듈이 환경변수를 읽기 전에 먼저 .env를 로드해야 함

from db import log_event, get_recent_searches
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


LASTFM_PLACEHOLDER_HASH = "2a96cbd8b46e442fc41c2b86b821562f"


def best_image(images: list) -> Optional[str]:
    """
    Last.fm 이미지 배열에서 가장 큰 이미지를 골라 반환.
    주의: 실제 이미지가 없을 때 Last.fm은 빈 문자열이 아니라 자체 기본 플레이스홀더
    이미지(회색 별 아이콘) URL을 내려줌. 이 URL은 파일명 해시가 항상 고정돼있어서
    ("2a96cbd8b46e442fc41c2b86b821562f"), 이걸 걸러내지 않으면 "이미지가 있다"고
    착각해서 iTunes 폴백으로 넘어가지 않는 문제가 있었음.
    """
    if not images:
        return None
    for img in reversed(images):
        url = img.get("#text")
        if url and LASTFM_PLACEHOLDER_HASH not in url:
            return url
    return None


def fetch_itunes_artwork(artist_name: str, track_name: str) -> Optional[str]:
    """
    Last.fm은 몇 년 전부터 '트랙(곡)' 단위 앨범 이미지를 거의 안 줌 (아티스트 이미지는 있어도
    곡 커버는 라이선스 문제로 빠진 케이스가 대부분). 그래서 Apple의 iTunes Search API(키 불필요, 무료)로
    같은 아티스트+곡명을 검색해서 앨범 커버를 보완해온다.
    """
    try:
        res = requests.get(
            "https://itunes.apple.com/search",
            params={"term": f"{artist_name} {track_name}", "entity": "song", "limit": 1},
            timeout=3,
        )
        if res.status_code != 200:
            print(f"[itunes] {artist_name} - {track_name}: 상태코드 {res.status_code}")
            return None
        results = res.json().get("results", [])
        if not results:
            print(f"[itunes] {artist_name} - {track_name}: 검색 결과 없음")
            return None
        artwork = results[0].get("artworkUrl100")
        if not artwork:
            print(f"[itunes] {artist_name} - {track_name}: artworkUrl100 없음")
            return None
        # iTunes가 기본으로 주는 100x100 썸네일 대신 더 큰 해상도로 교체
        return artwork.replace("100x100bb", "600x600bb")
    except Exception as e:
        # 이미지 보완은 부가 기능 — 실패해도 트랙 자체는 그대로 보여줘야 함 (장애 격리)
        print(f"[itunes] {artist_name} - {track_name}: 예외 발생 - {e}")
        return None


def resolve_track_image(artist_name: str, track_name: str, images: list) -> Optional[str]:
    lastfm_image = best_image(images)
    if lastfm_image:
        return lastfm_image
    return fetch_itunes_artwork(artist_name, track_name)


def track_image(track: dict) -> Optional[str]:
    # artist.getTopTracks/tag.getTopTracks 같은 대부분의 Last.fm 응답은 track["artist"]가
    # {"name": ...} 형태의 dict인데, track.search만 예외적으로 문자열을 줘서 별도 처리(resolve_track_image)로 분리함.
    return resolve_track_image(track["artist"]["name"], track["name"], track.get("image", []))


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


@app.get("/search")
def search(q: str, x_session_id: Optional[str] = Header(default=None)):
    """
    통합 검색: 아티스트 이름뿐 아니라 곡 제목으로도 찾을 수 있게 artist.search와
    track.search를 같이 호출해서 합쳐 반환. 기존 /search-artist는 아티스트 전용이라
    "노래 제목은 기억나는데 아티스트는 모르는" 상황을 못 다뤘음 — 실사용 흐름에 맞춰 확장.
    """
    cache_key = f"search:{q.lower().strip()}"
    cached = get_cached(cache_key)
    if cached is not None:
        if x_session_id:
            total = len(cached["artists"]) + len(cached["tracks"])
            log_event(x_session_id, "search", q, result_count=total)
        return {**cached, "cached": True}

    # 한글 검색어는 먼저 자체 후보 목록에서 "정확한 철자"를 찾아 그걸로 검색한다 —
    # Last.fm의 artist.search는 부분 문자열까지 매치해주는데, 이름에 우연히 같은 글자가
    # 섞인 저품질/중복 아티스트 페이지(예: "IU (아이우)", 청취자 2명)가 먼저 걸리는 걸
    # 실제로 확인함. 그래서 "결과가 없을 때만 교정 시도"가 아니라, 한글이면 아예 먼저
    # 후보 목록으로 검증된 철자를 쓰고, 그 다음에야 Last.fm 원본 검색어로 넘어간다.
    corrected_artist_name = None
    effective_artist_query = q
    if HANGUL_PATTERN.search(q):
        match = fuzzy_process.extractOne(q, KNOWN_KOREAN_ARTIST_NAMES, score_cutoff=60)
        if match and match[0] != q:
            effective_artist_query = match[0]
            corrected_artist_name = match[0]

    artist_data = lastfm_get({"method": "artist.search", "artist": effective_artist_query, "limit": 5})
    artist_matches = artist_data.get("results", {}).get("artistmatches", {}).get("artist", [])

    # 그래도 결과가 없고(한글 후보 목록에도 없었고) 영문이면, Last.fm 자체 오타 교정을 한 번 더 시도
    if not artist_matches and not HANGUL_PATTERN.search(q):
        try:
            correction_data = lastfm_get({"method": "artist.getcorrection", "artist": q})
            correction = correction_data.get("corrections", {}).get("correction")
            corrected_name = None
            if isinstance(correction, dict):
                corrected_name = correction.get("artist", {}).get("name")
            if corrected_name and corrected_name.lower() != q.lower():
                corrected_artist_name = corrected_name
                retry_data = lastfm_get({"method": "artist.search", "artist": corrected_name, "limit": 5})
                artist_matches = retry_data.get("results", {}).get("artistmatches", {}).get("artist", [])
        except Exception as e:
            # 오타 교정은 부가 기능 — 실패해도 검색 자체(빈 결과)는 그대로 진행 (장애 격리)
            print(f"[search-correction] '{q}' 교정 시도 실패 (무시하고 진행): {e}")

    artists = [
        {
            "name": item["name"],
            "mbid": item.get("mbid"),
            "image": best_image(item.get("image", [])),
            "listeners": item.get("listeners"),
        }
        for item in artist_matches
    ]

    track_data = lastfm_get({"method": "track.search", "track": q, "limit": 8})
    track_matches = track_data.get("results", {}).get("trackmatches", {}).get("track", [])
    tracks = [
        {
            "name": item["name"],
            # track.search만 예외적으로 artist가 dict가 아니라 문자열로 옴
            "artist": item.get("artist", ""),
            "listeners": item.get("listeners"),
            "url": item.get("url"),
            "image": resolve_track_image(item.get("artist", ""), item["name"], item.get("image", [])),
        }
        for item in track_matches
    ]

    result = {"artists": artists, "tracks": tracks, "correctedArtistName": corrected_artist_name}
    set_cached(cache_key, result)

    if x_session_id:
        log_event(x_session_id, "search", q, result_count=len(artists) + len(tracks))

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
                "image": track_image(track),
            })

    result = {"tracks": tracks}
    set_cached(cache_key, result)

    if x_session_id:
        log_event(x_session_id, "recommend_click", artist_name, result_count=len(tracks))

    return {**result, "cached": False}


def fetch_artist_thumbnail(artist_name: str) -> Optional[str]:
    """
    사이드바 '최근 검색'에 쓸 작은 아티스트 이미지 하나만 가져옴.
    /search-artist는 검색어당 5명을 다 가져오지만 여긴 이름 하나당 이미지 하나만 필요해서
    더 가벼운 artist.getInfo를 씀. 자주 안 바뀌는 정보라 캐싱도 동일하게 적용.
    """
    cache_key = f"artist-image:{artist_name.lower().strip()}"
    cached = get_cached(cache_key)
    if cached is not None:
        return cached.get("image")

    try:
        data = lastfm_get({"method": "artist.getInfo", "artist": artist_name})
        image = best_image(data.get("artist", {}).get("image", []))
    except Exception:
        # 썸네일은 부가 정보 — 실패해도 목록 자체는 그대로 보여줘야 함 (장애 격리)
        image = None

    set_cached(cache_key, {"image": image})
    return image


@app.get("/recent-searches")
def recent_searches(x_session_id: Optional[str] = Header(default=None)):
    """
    사이드바 '최근 검색' 위젯용. 로그인이 없어서 세션ID 기준으로만 조회 가능 —
    세션ID가 없으면(예: 첫 방문, 헤더 누락) 빈 목록을 반환한다.
    """
    if not x_session_id:
        return {"artists": []}
    names = get_recent_searches(x_session_id)
    artists = [{"name": name, "image": fetch_artist_thumbnail(name)} for name in names]
    return {"artists": artists}


@app.get("/discover-by-mood")
def discover_by_mood(tag: str, x_session_id: Optional[str] = Header(default=None)):
    """
    아티스트를 검색하지 않고도, 무드/상황 태그(예: chill, workout)만으로 인기곡을 보여줌.
    유튜브 뮤직처럼 "검색 없이 홈 화면에서 바로 탐색"하는 흐름을 위한 엔드포인트.
    Last.fm의 tag.getTopTracks는 그 태그가 붙은 곡 중 인기순 상위 곡을 반환함.
    """
    cache_key = f"discover-by-mood:{tag.lower().strip()}"
    cached = get_cached(cache_key)
    if cached is not None:
        if x_session_id:
            log_event(x_session_id, "mood_browse", tag, result_count=len(cached["tracks"]))
        return {**cached, "cached": True}

    data = lastfm_get({
        "method": "tag.getTopTracks",
        "tag": tag,
        "limit": 10,
    })
    track_list = data.get("tracks", {}).get("track", [])
    tracks = [
        {
            "name": track["name"],
            "artist": track["artist"]["name"],
            # tag.getTopTracks는 청취자 수를 안 줘서(태그 인기 랭킹만 줌) listeners는 비워둠
            "listeners": None,
            "url": track.get("url"),
            "image": track_image(track),
        }
        for track in track_list
    ]

    result = {"tracks": tracks}
    set_cached(cache_key, result)

    if x_session_id:
        log_event(x_session_id, "mood_browse", tag, result_count=len(tracks))

    return {**result, "cached": False}
