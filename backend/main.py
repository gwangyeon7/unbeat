from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from pydantic import BaseModel
from typing import Optional
from rapidfuzz import process as fuzzy_process, fuzz
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from urllib.parse import quote
import anthropic
import json
import re
import requests
import os

# Last.fm의 artist.getCorrection은 영문 철자 간 편집 거리(edit distance) 기반이라
# 한글 입력("아이위" 등)엔 아예 안 맞음 — 한글 오타와 영문 정식명("아이위" ↔ "IU")은
# 글자 자체가 안 겹쳐서 전혀 엉뚱한 아티스트로 잘못 교정되는 걸 실제로 확인함.
# 대신 Last.fm은 한글 아티스트명 자체는(정확히 쓰면) 잘 찾아주므로("아이유" 검색은 정상 동작),
# 한글 오타는 자체 후보 목록에서 가장 비슷한 "정확한 한글 철자"를 찾아 그걸로 재검색하는 방식으로 처리.
HANGUL_PATTERN = re.compile(r"[가-힣]")

# 띄어쓰기가 아예 빠진 한글 검색어("꽃이피고지듯이" → "꽃이 피고 지듯이") 교정용(§45).
# 위의 KNOWN_KOREAN_ARTIST_NAMES 기반 교정은 "정확한 이름의 철자가 살짝 틀린" 경우만 잡고,
# 아예 목록에 없는 곡 제목이 띄어쓰기 없이 들어오는 경우는 못 잡아서 별도로 둠. PyKoSpacing은
# 사전 학습된 딥러닝 모델이라(TensorFlow 의존, 설치 용량이 꽤 큼) 매 요청마다 새로 로드하면
# 느려서 앱 시작 시 한 번만 로드해서 재사용 — 로드 자체가 실패해도(모델 파일 문제 등) 서비스
# 전체가 죽으면 안 되니 예외를 삼키고, 이후 교정 없이 원래 검색어로만 동작하도록 degrade.
try:
    from pykospacing import Spacing as _KoSpacing

    _korean_spacing_model = _KoSpacing()
except Exception as e:
    print(f"[search] PyKoSpacing 로드 실패 — 띄어쓰기 교정 없이 진행: {e}")
    _korean_spacing_model = None


def _correct_korean_spacing(text: str) -> Optional[str]:
    if _korean_spacing_model is None:
        return None
    try:
        corrected = _korean_spacing_model(text)
        return corrected if corrected and corrected != text else None
    except Exception as e:
        print(f"[search] 띄어쓰기 교정 실패 (무시하고 진행): {e}")
        return None


# (§52) 띄어쓰기 없는 영문 검색어("thatthat" → "that that") 교정용. §45의 PyKoSpacing과 같은
# 문제의 영문 버전 — "That That"(싸이 & 슈가)처럼 실제로 유명한 곡인데도 띄어쓰기를 빼고 검색하면
# Last.fm이 전혀 무관한 결과(THOTTWAT, Gurnazar Chattha 등 우연히 글자가 비슷한 아티스트)로
# 채워버리는 걸 실사용 중 발견함. PyKoSpacing 같은 딥러닝 모델 대신 `wordninja`(영어 단어
# 빈도 기반 동적계획법으로 이어붙은 단어를 가장 그럴듯하게 쪼개는 순수 파이썬 라이브러리, TensorFlow
# 같은 무거운 의존성 없음)를 씀 — 한글은 PyKoSpacing이, 영문은 wordninja가 담당하는 구조.
try:
    import wordninja
except Exception as e:
    print(f"[search] wordninja 로드 실패 — 영문 띄어쓰기 교정 없이 진행: {e}")
    wordninja = None


def _correct_english_spacing(text: str) -> Optional[str]:
    if wordninja is None:
        return None
    try:
        words = wordninja.split(text)
        corrected = " ".join(words)
        # wordninja는 숫자/기호가 섞이면 한 글자씩 쪼개버리는 등 이상하게 분리할 때가 있어서,
        # 결과 단어 수가 원래 글자 수만큼 잘게 쪼개졌으면(즉 의미 있는 분리가 아니면) 버림.
        if not corrected or corrected == text or len(words) >= len(text):
            return None
        return corrected
    except Exception as e:
        print(f"[search] 영문 띄어쓰기 교정 실패 (무시하고 진행): {e}")
        return None


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

# 무드 탐색 결과를 국내/해외로 나눌 때 쓰는 판별 기준. 국적을 알려주는 API가 따로 없어서
# 실용적으로 두 신호를 씀: (1) Last.fm 아티스트명에 한글이 포함돼 있으면 국내로 간주
# (국내 힙합/인디 아티스트는 실제로 한글명 그대로 등록된 경우가 많음 — 식케이/노윤하/김하온 등
# 실사용 중 확인함), (2) 로마자로 등록되는 경우가 많은 K팝 그룹은 별도 목록으로 보완.
# 완벽한 판별은 아니고(목록에 없는 로마자 아티스트는 놓칠 수 있음), 실사용하며 놓치는 아티스트를
# 발견하면 이 목록에 추가하는 식으로 커버리지를 넓혀갈 계획.
KNOWN_KOREAN_ARTIST_NAMES_LATIN = {
    "bts", "blackpink", "newjeans", "ive", "aespa", "twice", "stray kids",
    "seventeen", "itzy", "(g)i-dle", "g-idle", "gidle", "red velvet", "enhypen",
    "txt", "tomorrow x together", "le sserafim", "lesserafim", "nmixx", "riize",
    "zerobaseone", "zb1", "ateez", "exo", "nct", "nct dream", "nct 127", "nct u",
    "got7", "monsta x", "winner", "ikon", "bigbang", "big bang", "shinee",
    "super junior", "girls' generation", "girls generation", "snsd", "apink",
    "mamamoo", "iu", "psy", "epik high", "zico", "jay park", "crush", "dean",
    "hyukoh", "day6", "akmu", "kep1er", "billlie", "xg", "kara", "wonder girls",
    "2ne1", "sistar", "f(x)", "exid", "gfriend", "loona", "everglow", "oh my girl",
    "weki meki", "cignature", "dreamcatcher", "fromis_9", "stayc", "kep1er",
    "treasure", "victon", "ab6ix", "the boyz", "ncts", "xdinary heroes",
}


def _is_domestic_artist(artist_name: str) -> bool:
    if HANGUL_PATTERN.search(artist_name):
        return True
    return artist_name.strip().lower() in KNOWN_KOREAN_ARTIST_NAMES_LATIN


# Last.fm은 사용자가 스크로블러(예: 유튜브 확장 스크로블러)로 재생 기록을 남길 때, 유튜브
# 영상 제목("곡명 English Lyrics", "곡명(COVER)" 같은)이 파싱 오류로 그대로 "아티스트명"에
# 들어가버린 쓰레기 데이터를 실제로 갖고 있음(예: "As Flowers Bloom and Fall / 꽃이피고지듯이
# English Lyrics"라는 이름의 "아티스트"가 실존). 띄어쓰기 없이 붙여 쓴 한글 검색어(예: "꽃이피고지듯이",
# 원래 제목은 "꽃이 피고 지듯이")에서 track.search는 0건인데 artist.search는 이런 쓰레기 항목을
# 집어오는 걸 실제로 확인함 — 청취자 수가 극단적으로 적고, 이름에 "Lyrics"/"COVER"/"MV"처럼
# 유튜브 영상 제목에 흔한 표기가 섞여 있으면 진짜 아티스트가 아니라 이런 오염 데이터일 확률이
# 높다고 보고 걸러냄. 정교한 판별은 아니라서(이름이 우연히 겹치는 극소수 정상 아티스트를
# 놓칠 수 있음), 실사용 중 오탐이 발견되면 조건을 조정할 것.
#
# (§50) 원래는 "청취자 5명 이하 AND 이름에 lyrics/cover/mv 같은 키워드 포함"일 때만 걸러냈는데,
# "국보급 허스키 보이스로 몰입시키는😨 8호 가수의 <꽃이 피고 지듯이>♪"(청취자 2명)처럼 키워드가
# 하나도 없는 방송/영상 설명문 형태의 쓰레기 항목이 그대로 통과되는 걸 발견함. 실사용 중
# Last.fm에 진짜로 등록된 아티스트가 청취자 5명 이하인 경우는 사실상 못 봤고(전세계 서비스라
# 아무리 무명이어도 보통 수십 명 이상), 반대로 청취자 극소수인 항목은 거의 다 스크로블 오매칭/
# 영상 제목 오등록이었음 — 그래서 이름 키워드 조건을 없애고 "청취자 수만으로" 판단하도록 단순화.
# 트레이드오프: 아주 드물게 방금 등록된 진짜 신인 아티스트가 걸러질 수 있음 — 실사용 중 오탐이
# 늘어나면 다시 조정할 것.
JUNK_ARTIST_LISTENER_THRESHOLD = 5


def _is_junk_artist_match(item: dict) -> bool:
    try:
        listeners = int(item.get("listeners") or 0)
    except (TypeError, ValueError):
        listeners = 0
    return listeners <= JUNK_ARTIST_LISTENER_THRESHOLD


# /search에서 원래 검색어와 띄어쓰기 교정된 검색어(§45) 둘 다로 결과를 만들어야 해서,
# Last.fm 응답 -> 프론트에 내려줄 dict 변환 로직을 공용 함수로 뽑음(중복 방지).
def _build_artist_results(artist_matches: list) -> list:
    return [
        {
            "name": item["name"],
            "mbid": item.get("mbid"),
            "image": best_image(item.get("image", [])),
            "listeners": item.get("listeners"),
        }
        for item in artist_matches
        if not _is_junk_artist_match(item)
    ]


# (§54) 아티스트 검색에만 쓰레기 필터(_is_junk_artist_match)가 있고 트랙 검색엔 없어서, "댓댓"
# 같은 검색어가 팬캠/방송 영상 스크로블(예: 청취자 43명, 23명, 11명, 7명짜리 "[FANCAM] ...",
# "윤기 깜짝게스트 댓...")로 채워지는 걸 실사용 중 발견 — 이 쓰레기 매치들이 "결과 있음"으로
# 잡혀버려서 §53의 AI 폴백까지 아예 도달을 못 하는 문제로 이어짐. 처음엔 §50의 아티스트
# 필터처럼 "청취자 50명 이하는 쓰레기"로 잡았는데(v8), "동암역 2번 출구" 라이브 진단 중
# 장범준(버스커버스커, 실제 유명 가수)의 정식 발매곡 "신풍역 2번 출구 블루스"도 청취자
# 6~46명으로 똑같이 걸러지는 걸 실제로 확인함(§55). 즉 Last.fm의 한국 트랙 단위 스크로블이
# 워낙 얕아서, 무명 쓰레기와 유명 가수 정식곡이 청취자 수로는 구분이 안 됨 — 아티스트 청취자
# 수(그 아티스트의 모든 곡 합산)와 달리 트랙 청취자 수는 곡 하나만의 값이라 이 차이가 남.
# 그래서 숫자 임계값을 버리고 §45 이전 방식(패턴/키워드 기반)으로 돌아가되, 이번엔 트랙 제목/
# 아티스트 필드에 특화된 형식적 특징으로 판별: (1) 제목이 대괄호로 시작("[FANCAM] ...")하거나,
# (2) 아티스트 필드에 6자리 날짜가 박혀있거나(방송/이벤트명, 예: "220716 싸이 흠뻑쇼"),
# (3) 아티스트 이름이 "OO CH"/"OO TV"처럼 유튜브 채널명 패턴으로 끝나거나,
# (4) 팬캠/직캠/리액션 등 명시적 키워드가 포함된 경우.
# 트레이드오프: 이 패턴에 안 걸리는 애매한 쓰레기(예: 개인 커버 채널이 평범한 이름을 쓴 경우)는
# 여전히 통과할 수 있음 — 이건 아래 "저신뢰 트랙이면 AI로 한 번 더 확인"(§55) 로직이 보완함.
JUNK_TRACK_KEYWORD_MARKERS = (
    "팬캠", "직캠", "fancam", "reaction", "리액션", "깜짝게스트", "라이브클립", "무편집",
    # (버그 수정) "위대한 쇼맨 ost" 검색 중 "호야팀 K-WAVE 단체 무대 ♬ 위대한 쇼맨 OST"처럼
    # 댄스 서바이벌 방송("댄싱하이" 등)의 커버 무대 영상이 정식 곡처럼 섞여 나오는 걸 발견 —
    # 노래 자체가 아니라 그 노래에 맞춰 춘 참가팀 무대 영상이라 §54와 같은 원칙으로 필터링.
    "단체 무대",
)


def _is_junk_track_match(item: dict) -> bool:
    name = (item.get("name") or "").strip()
    artist = (item.get("artist") or "").strip()
    combined = f"{name} {artist}".lower()

    is_junk = (
        name.startswith("[")
        or any(marker in combined for marker in JUNK_TRACK_KEYWORD_MARKERS)
        or bool(re.search(r"\b\d{6}\b", artist))  # 방송/이벤트명에 흔한 6자리 날짜(YYMMDD)
        or bool(re.search(r"\b(CH|TV)$", artist, re.IGNORECASE))  # 유튜브 채널명 패턴
    )
    if is_junk:
        print(f"[search-junk-track-filter] 걸러짐: {artist!r} - {name!r}")
    return is_junk


def _build_track_results(track_matches: list) -> list:
    return [
        {
            "name": item["name"],
            # track.search만 예외적으로 artist가 dict가 아니라 문자열로 옴
            "artist": _clean_artist_name(item.get("artist", "")),
            "listeners": item.get("listeners"),
            "url": item.get("url"),
            "image": resolve_track_image(
                _clean_artist_name(item.get("artist", "")), item["name"], item.get("image", [])
            ),
        }
        for item in track_matches
        if not _is_junk_track_match(item)
    ]


# "2010년대 kpop"처럼 아티스트/곡 이름이 아니라 장르·연대 키워드로 검색하는 경우를 위해 추가.
# 무드 칩(MOODS)과 같은 아이디어 — 한국어 키워드를 Last.fm 크라우드 태그(영문)로 매핑함.
GENRE_KEYWORDS = {
    "케이팝": "k-pop", "kpop": "k-pop", "k-pop": "k-pop",
    "국힙": "korean hip hop", "힙합": "hip hop", "hiphop": "hip hop", "hip hop": "hip hop",
    "발라드": "ballad", "ballad": "ballad",
    "락": "rock", "rock": "rock",
    "재즈": "jazz", "jazz": "jazz",
    "알앤비": "r&b", "알엔비": "r&b", "r&b": "r&b", "rnb": "r&b",
    "인디": "indie", "indie": "indie",
    "일렉트로니카": "electronic", "일렉": "electronic", "electronic": "electronic", "edm": "edm",
    "댄스": "dance", "dance": "dance",
    "팝": "pop", "pop": "pop",
}

# "2010년대"/"2010s"/"90년대" 같은 연대 표현에서 10년 단위 태그(예: "2010s")를 뽑아냄.
# 두 자리 연도(예: "90년대")는 50 이상이면 19XX, 미만이면 20XX로 보는 관례를 따름.
DECADE_PATTERN = re.compile(r"(\d{2,4})\s*(?:년대|s)\b", re.IGNORECASE)


def _extract_genre_tag(query: str) -> Optional[str]:
    lowered = query.lower()
    for keyword in sorted(GENRE_KEYWORDS, key=len, reverse=True):
        if keyword in lowered:
            return GENRE_KEYWORDS[keyword]
    return None


def _extract_decade_tag(query: str) -> Optional[str]:
    match = DECADE_PATTERN.search(query)
    if not match:
        return None
    num = int(match.group(1))
    if num >= 1000:
        year = num
    elif num >= 50:
        year = 1900 + num
    else:
        year = 2000 + num
    return f"{(year // 10) * 10}s"


load_dotenv()  # db 모듈이 환경변수를 읽기 전에 먼저 .env를 로드해야 함

from db import log_event, get_lyrics_requests
from cache import (
    get_cached,
    set_cached,
    delete_cached,
    push_search_history,
    get_search_history,
    remove_search_history,
    push_recent_play,
    get_recent_plays,
)


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

# 트랙 카드를 눌렀을 때 Last.fm 자체 페이지로 내보내는 대신, 사이트 안에서 바로 재생되는 것처럼
# 보이게 하려고 추가. Last.fm은 메타데이터/스크로블링 서비스라 오디오 스트리밍 자체가 없고,
# 우리도 자체 라이선스 스트리밍은 없으니 유튜브 영상을 찾아 그 영상만 사이트 안에 임베드하는 절충안.
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY")
YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"

# "빠른 선곡"을 실제 개인화 추천으로 바꾸기 위해 추가 — 이 프로젝트의 첫 유료 API 의존성.
# 그전까지는 즐겨찾기 아티스트 하나를 골라 artist.getSimilar로 후보를 넓히는 방식(§37)이었는데,
# 사용자가 "요즘 유튜브가 쓰는 방식을 해보고 싶다"고 해서 LLM에게 취향(즐겨찾기 목록)을 주고
# 새로운 곡을 추천받는 방식으로 전환. 키가 없으면 엔드포인트가 503을 내고, 프론트는 기존
# artist.getSimilar 방식으로 자동 폴백한다(신규 개발자가 API 키 없이 클론해도 앱 전체가 죽지 않게).
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"  # 추천 하나에 몇백 토큰이면 충분해서 저렴한 Haiku로 선택


def lastfm_get(params: dict):
    """Last.fm API 공통 호출 헬퍼. OAuth 없이 api_key만 있으면 read 메서드 사용 가능."""
    params = {
        **params,
        "api_key": LASTFM_API_KEY,
        "format": "json",
    }
    res = requests.get(LASTFM_BASE_URL, params=params)
    if res.status_code != 200:
        print(f"[lastfm] 요청 실패 ({res.status_code}) params={params}: {res.text[:200]}")
        raise HTTPException(status_code=res.status_code, detail="Last.fm API 요청 실패")
    # Last.fm 응답이 charset을 안 알려줘서 requests가 인코딩을 잘못 추측하는 경우가 있음 -> UTF-8로 고정
    res.encoding = "utf-8"
    data = res.json()
    if "error" in data:
        # "국내 인기 차트" 행이 화면에서 통째로 안 뜨는 문제를 진단하기 위해 추가.
        # geo.getTopTracks에 country 값이 Last.fm이 인식 못 하는 국가명이면 여기서 에러가 나는데,
        # 프론트는 .catch()로 조용히 빈 배열 처리하니 백엔드 터미널에 안 찍히면 원인을 알 방법이 없었음.
        print(f"[lastfm] API 오류 params={params}: {data}")
        raise HTTPException(status_code=400, detail=data.get("message", "Last.fm API 오류"))
    return data


LASTFM_PLACEHOLDER_HASH = "2a96cbd8b46e442fc41c2b86b821562f"

TOPIC_SUFFIX_PATTERN = re.compile(r"\s*[-–]\s*Topic\s*$", re.IGNORECASE)


def _clean_artist_name(name: str) -> str:
    """
    유튜브가 공식 채널 없는 아티스트에게 자동으로 만들어주는 "아티스트명 - Topic" 채널 이름이,
    Last.fm 쪽 크라우드소싱 데이터에도(특히 케이팝) 그대로 아티스트명으로 잘못 들어간 경우가
    실사용 중 발견됨(예: "aespa - Topic", "IVE - Topic") — 화면에 그대로 노출되고, 이 이름으로
    iTunes 이미지 검색을 하면 매칭이 안 돼서 카드 썸네일이 빈 음표 아이콘으로 뜨는 원인도 됐음.
    Last.fm 응답이든 유튜브 채널명이든, 아티스트명을 쓰는 모든 자리에서 이 접미사를 제거함.
    """
    if not name:
        return name
    return TOPIC_SUFFIX_PATTERN.sub("", name).strip()


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


def fetch_itunes_artist_artwork(artist_name: str) -> Optional[str]:
    """
    "인기 아티스트" 카드용 이미지 보완. Last.fm은 아티스트 프로필 이미지를 몇 년 전부터
    거의 안 주고(대부분 빈 배열), iTunes Search API도 아티스트 자체의 인물 사진은 안 줌
    (entity=musicArtist 응답엔 이미지 필드가 아예 없음) — 그래서 그 아티스트의 대표 앨범
    커버(entity=album, 첫 번째 결과)를 대신 보여주는 절충안을 씀. 엄밀히는 "얼굴 사진"이
    아니라 "대표작 커버"라는 한계가 있지만, 빈 회색 원보다는 훨씬 낫다는 판단.
    """
    try:
        res = requests.get(
            "https://itunes.apple.com/search",
            params={"term": artist_name, "entity": "album", "limit": 1},
            timeout=3,
        )
        if res.status_code != 200:
            return None
        results = res.json().get("results", [])
        if not results:
            return None
        artwork = results[0].get("artworkUrl100")
        if not artwork:
            return None
        return artwork.replace("100x100bb", "600x600bb")
    except Exception as e:
        print(f"[itunes] 아티스트 이미지 조회 실패 ({artist_name}): {e}")
        return None


TRACK_IMAGE_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30  # 30일 — 앨범 커버는 사실상 안 바뀌니 길게 캐싱
# (§51) 이미지를 못 찾은 경우("url": None)까지 30일 캐싱해버리면, iTunes 요청 폭주로 한 번
# 실패한 게 그대로 한 달 동안 "이 곡은 이미지 없음"으로 굳어버리는 부작용이 있었음(아래 §51 참고).
# 실패는 짧게만 캐싱해서 곧 재시도되게 함.
TRACK_IMAGE_NEGATIVE_CACHE_TTL_SECONDS = 60 * 30  # 30분


def resolve_track_image(artist_name: str, track_name: str, images: list) -> Optional[str]:
    """
    "카드 이미지가 그냥 가수 프로필 사진처럼 보인다"는 피드백으로 우선순위를 바꿈 — 원래는
    Last.fm 이미지를 먼저 쓰고 없을 때만 iTunes로 보완했는데, Last.fm의 이미지 배열은 실제로는
    특정 싱글/앨범 커버가 아니라 그 아티스트의 범용 프로모 사진인 경우가 많음(크라우드소싱이라
    곡 단위로 정확한 커버를 안 붙여둔 게 대부분). 반면 iTunes Search API는 검색어에 맞는 실제
    발매 커버를 주는 경우가 훨씬 많아서, iTunes를 먼저 시도하고 실패할 때만 Last.fm으로 폴백함.

    (§48) iTunes Search API는 비공식적으로 짧은 시간에 너무 많이 부르면 응답이 비거나 느려지는
    사례가 실제로 있었음 — "다음 트랙" 큐처럼 한 번의 요청에서 후보 수십 곡의 이미지를 한꺼번에
    조회하면, 앞쪽 몇 곡은 이미지가 뜨는데 뒤쪽으로 갈수록 이미지가 안 뜨는 패턴이 관찰됨(요청
    순서상 나중에 불린 곡들이 몰려서 걸린 것으로 추정). 같은 곡은 검색/차트/추천/무드/다음 트랙
    큐 등 여러 엔드포인트에서 반복해서 조회되는 경우가 많으므로, 한 번 찾은 이미지는 Redis에
    캐싱해서 재사용 — 같은 곡을 다시 조회할 땐 iTunes를 아예 안 부르게 됨.
    """
    cache_key = f"track-image:v2:{artist_name.lower().strip()}:{track_name.lower().strip()}"
    cached = get_cached(cache_key)
    if cached is not None:
        return cached.get("url")

    itunes_image = fetch_itunes_artwork(artist_name, track_name)
    image = itunes_image or best_image(images)
    # (§51) 찾았을 때만 길게(30일) 캐싱하고, 못 찾았을 때는 짧게(30분)만 캐싱 — iTunes 호출이
    # 몰려서 일시적으로 실패한 것뿐인데 그걸 "이 곡은 이미지가 없다"고 한 달씩 확정 지어버리면
    # 안 되기 때문. BLACKPINK/Lisa/JISOO처럼 이미지가 확실히 있어야 할 메이저 아티스트 곡들이
    # 그룹째로 이미지가 안 뜨는 걸 발견해서 원인을 추적하다가 찾음 — 캐싱을 추가한 직후 iTunes
    # 요청이 몰렸던 시점에 실패한 결과가 그대로 30일 캐싱되어 버렸던 것.
    ttl = TRACK_IMAGE_CACHE_TTL_SECONDS if image else TRACK_IMAGE_NEGATIVE_CACHE_TTL_SECONDS
    set_cached(cache_key, {"url": image}, ttl=ttl)
    return image


def track_image(track: dict) -> Optional[str]:
    # artist.getTopTracks/tag.getTopTracks 같은 대부분의 Last.fm 응답은 track["artist"]가
    # {"name": ...} 형태의 dict인데, track.search만 예외적으로 문자열을 줘서 별도 처리(resolve_track_image)로 분리함.
    # "- Topic" 접미사(_clean_artist_name)를 먼저 걷어내야 iTunes 검색 매칭률이 올라감.
    artist_name = _clean_artist_name(track["artist"]["name"])
    return resolve_track_image(artist_name, track["name"], track.get("image", []))


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


@app.get("/search-suggest")
def search_suggest(q: str):
    """
    검색창에 한 글자씩 칠 때마다 보여줄 자동완성 후보(유튜브 뮤직 검색창처럼 "numb"만 쳐도
    "Numb Little Bug" 같은 후보가 뜨게 해달라는 요청으로 추가). 기존 /search는 오타 교정,
    AI 추측, 유튜브 폴백에 iTunes 이미지 리졸브까지 포함된 "정확한 최종 결과"용이라 매
    키 입력마다 부르기엔 너무 무겁고 느림 — 그래서 이미지 리졸브 없이 이름만 빠르게 주는
    가벼운 전용 엔드포인트로 분리함. 세션 로그(log_event)도 실제 검색이 아니라 타이핑
    중간값이라 남기지 않음(/search가 최종 제출 시 이미 남김).
    """
    trimmed = q.strip()
    if len(trimmed) < 2:
        return {"tracks": [], "artists": []}

    # 후보 목록은 최신성보다 응답 속도가 중요하고, 같은 접두어를 여러 사용자가 반복 입력할
    # 가능성이 높아서(예: "아이" -> "아이유") /search(1시간)보다 훨씬 긴 TTL을 씀.
    cache_key = f"search-suggest:v1:{trimmed.lower()}"
    cached = get_cached(cache_key)
    if cached is not None:
        return {**cached, "cached": True}

    track_data = lastfm_get({"method": "track.search", "track": trimmed, "limit": 8})
    track_matches = track_data.get("results", {}).get("trackmatches", {}).get("track", [])
    tracks = [
        {"name": item["name"], "artist": _clean_artist_name(item.get("artist", ""))}
        for item in track_matches
        if not _is_junk_track_match(item)
    ][:6]

    artist_data = lastfm_get({"method": "artist.search", "artist": trimmed, "limit": 5})
    artist_matches = artist_data.get("results", {}).get("artistmatches", {}).get("artist", [])
    artists = [item["name"] for item in artist_matches if not _is_junk_artist_match(item)][:4]

    result = {"tracks": tracks, "artists": artists}
    set_cached(cache_key, result, ttl=60 * 60 * 6)
    return {**result, "cached": False}


@app.get("/search")
def search(q: str, x_session_id: Optional[str] = Header(default=None)):
    """
    통합 검색: 아티스트 이름뿐 아니라 곡 제목으로도 찾을 수 있게 artist.search와
    track.search를 같이 호출해서 합쳐 반환. 기존 /search-artist는 아티스트 전용이라
    "노래 제목은 기억나는데 아티스트는 모르는" 상황을 못 다뤘음 — 실사용 흐름에 맞춰 확장.
    """
    # v2: §31에서 트랙 이미지 우선순위를 Last.fm→iTunes에서 iTunes→Last.fm으로 뒤집었는데,
    # 이 캐시 키를 안 바꾸면 그 전에 저장된 캐시가 만료(기본 1시간)될 때까지 옛날 이미지가
    # 계속 나감 — [[학습노트 29번]]에서 이미 겪은 "캐시 키 버전 관리" 문제와 같은 케이스.
    # v3: 쓰레기 아티스트 매치 필터링(_is_junk_artist_match, §45) 추가로 같은 이유 재적용.
    # v4: 띄어쓰기 없는 한글 검색어에 PyKoSpacing 교정 재시도(§45) 추가로 같은 이유 재적용 —
    # 이 캐시 키를 안 올리면 예전에 "결과 없음"으로 저장된 검색어들이 새 폴백을 안 타고 그대로 나감.
    # v5: 쓰레기 아티스트 판별을 "청취자 수만으로" 단순화(§50)해서 같은 이유로 재적용 — 이 키를
    # 안 올리면 예전에 걸러지지 않고 캐싱된 쓰레기 아티스트가 캐시 만료 전까지 그대로 나감.
    # v6: 띄어쓰기 없는 영문 검색어에 wordninja 교정 재시도(§52) 추가로 같은 이유 재적용 — 이 키를
    # 안 올리면 예전에 "결과 없음"으로 캐싱된 영문 검색어들이 새 폴백을 안 타고 그대로 나감.
    # v7: Claude Haiku 기반 검색어 추측 폴백(§53) 추가로 같은 이유 재적용 — 이 키를 안 올리면
    # 예전에 "결과 없음"으로 캐싱된 검색어들이 새 AI 폴백을 안 타고 그대로 나감.
    # v8: 트랙 검색에도 쓰레기 필터(_is_junk_track_match, §54) 추가로 같은 이유 재적용 — 이 키를
    # 안 올리면 예전에 팬캠/방송클립 쓰레기가 섞인 채로 캐싱된 결과가 그대로 나가고, §53 AI
    # 폴백도 여전히 발동을 못 함.
    # v9: 로직 자체는 안 바뀌었지만(§55 디버그 로그만 추가), "동암역 2번 출구"처럼 이미 "결과
    # 없음"으로 캐싱된 검색어를 강제로 다시 계산시켜서 새로 추가한 진단 로그를 터미널에서 볼 수
    # 있게 하려고 버전업 — 평소엔 로직이 안 바뀌면 버전업 안 하는 게 원칙이지만, 이번엔 "캐싱된
    # 빈 결과를 무효화해서 다시 실행시켜야 진단이 된다"는 실용적 이유로 예외적으로 올림.
    # v10: 진단 결과(§55) 트랙 쓰레기 필터를 청취자 수 임계값 -> 패턴 기반으로 재설계하고, AI
    # 폴백 트리거 조건을 "트랙이 아예 없을 때"에서 "있어도 전부 저신뢰(청취자 100명 미만)일 때"로
    # 넓힘 — 같은 이유로 재적용(예전에 저신뢰 트랙만 있는 채로 캐싱된 검색어들이 새 로직을 안
    # 타고 그대로 나가는 걸 막기 위함).
    # v11: (§56) "신뢰도" 판단이 청취자 수만 보고 검색어와의 관련성을 안 봐서, "동암역 2번 출구"
    # 검색 시 전혀 다른 곡("신풍역 2번 출구 블루스", 청취자 318명)이 인기 있다는 이유만으로
    # 전체를 "신뢰함"으로 오판해 AI 폴백이 스킵되던 버그 수정 — rapidfuzz partial_ratio로 검색어
    # 관련성까지 같이 봄. 같은 이유로 재적용(예전에 이 버그로 잘못 "신뢰함"으로 캐싱된 검색어들이
    # 새 로직을 안 타고 그대로 나가는 걸 막기 위함).
    # v12: (§57) AI 폴백이 "아티스트만 맞고 곡은 무관한" Last.fm 결과를 그대로 검증 통과시키던
    # 버그 수정(추측 곡명과 결과 곡명 사이 유사도까지 확인) + AI 폴백 캐싱을 함수 내부에서
    # 호출부로 옮기고 검증 성공/실패에 따라 TTL을 다르게 줌(90일/1일, §51과 동일한 네거티브
    # 캐시 원칙). 같은 이유로 재적용 — 예전에 잘못된 AI 추측이 섞인 채로 캐싱된 검색어들이
    # 새 로직을 안 타고 그대로 나가는 걸 막기 위함.
    # v13: (§58) v12로도 못 막은 사고 — 트랙 추측이 검증 실패했는데도, 그 트랙을 부른다고 AI가
    # 지목한 아티스트("싸이")가 원래 유명해서 Last.fm에 당연히 존재하니 "아티스트 검증 성공"으로
    # 둔갑해 완전히 무관한 아티스트 카드가 뜨고 검증됨=True로 90일 캐싱까지 되던 버그 수정 —
    # 아티스트 단독 검증은 AI가 애초에 트랙 추측을 안 했을 때만 시도하도록 좁힘. 같은 이유로
    # 재적용 — 예전에 이 버그로 잘못 캐싱된 검색어들이 새 로직을 안 타고 그대로 나가는 걸 막기 위함.
    # v14: (§59) Last.fm + AI 폴백까지 다 실패했을 때 쓰는 유튜브 검색 폴백 신규 추가
    # (`youtubeFallbackUsed` 응답 필드 추가) — 스키마가 바뀌었으니 재적용.
    # v15: v14로 처음 라이브 테스트했을 때, §58에서 고친 AI 폴백 로직 자체는 새로 실행됐지만
    # 그 안에서 참조하는 중첩 캐시(`search-ai-fallback:v1:...`)가 §58 수정 전 값을 그대로 갖고
    # 있어서 잘못된 결과가 나왔고, 그 잘못된 결과가 이 v14 캐시에 그대로 저장돼버림 — 안쪽
    # 캐시(v2로 버전업, 위 주석 참고)만 올리고 바깥쪽을 안 올리면 이미 오염된 v14 캐시가
    # 남아있어서 다시 검색해도 여전히 틀린 결과가 나감. 중첩 캐시를 고칠 땐 바깥쪽도 같이
    # 올려야 한다는 걸 이번에 직접 겪음.
    # v16: 한글 아티스트 후보 교정 score_cutoff 60→65로 상향(바로 아래 주석 참고, "위대한 쇼맨
    # ost"→"위너" 오교정 수정) — 이 키를 안 올리면 예전에 잘못 교정된 채로 캐싱된 검색어들이
    # 새 로직을 안 타고 그대로 나감.
    # v17: 트랙 쓰레기 필터에 "단체 무대"(댄스 서바이벌 방송 커버 무대 영상) 키워드 추가(§54와
    # 같은 원칙) — 이 키를 안 올리면 예전에 이 쓰레기가 안 걸러진 채로 캐싱된 검색어들이 그대로 나감.
    # v18: 장르/연대 키워드로 보이는 검색어("2010년대 kpop")는 AI 단일곡 추측/유튜브 단일곡 폴백을
    # 건너뛰고 바로 태그 기반 "모음"(tagTracks)만 쓰도록 변경 — 이 키를 안 올리면 예전에 AI가 엉뚱한
    # 곡 하나를 추측해서 "검색된 곡"에 그 한 곡만 뜨던 채로 캐싱된 검색어들이 그대로 나감.
    # v19: 장르+연대 태그를 합칠 때 순차로 다 채우고 넘어가던 걸 라운드로빈으로 바꿈(바로 아래
    # 주석 참고, "2010년대 kpop" 결과가 전부 서구 팝이던 문제 수정) — 이 키를 안 올리면 예전에
    # 한쪽 태그가 독식한 채로 캐싱된 검색어들이 그대로 나감.
    cache_key = f"search:v19:{q.lower().strip()}"
    cached = get_cached(cache_key)
    if cached is not None:
        if x_session_id:
            # .get()으로 방어: tagTracks 필드 추가 전에 캐싱된 옛 응답에도 안전하게 대응
            # (스키마를 바꿀 때 캐시 키를 버전업 안 해도 되도록, 없는 키는 없는 대로 취급).
            total = len(cached["artists"]) + len(cached["tracks"]) + len(cached.get("tagTracks", []))
            log_event(x_session_id, "search", q, result_count=total)
            push_search_history(x_session_id, q)
        return {**cached, "cached": True}

    # 한글 검색어는 먼저 자체 후보 목록에서 "정확한 철자"를 찾아 그걸로 검색한다 —
    # Last.fm의 artist.search는 부분 문자열까지 매치해주는데, 이름에 우연히 같은 글자가
    # 섞인 저품질/중복 아티스트 페이지(예: "IU (아이우)", 청취자 2명)가 먼저 걸리는 걸
    # 실제로 확인함. 그래서 "결과가 없을 때만 교정 시도"가 아니라, 한글이면 아예 먼저
    # 후보 목록으로 검증된 철자를 쓰고, 그 다음에야 Last.fm 원본 검색어로 넘어간다.
    #
    # (버그 수정) "위대한 쇼맨 ost"(영화 OST를 찾으려던 검색)가 엉뚱하게 "위너"로 교정되던 문제 —
    # score_cutoff=60이 너무 낮아서, WRatio가 부분 문자열 겹침에 후한 점수를 줌("위대한"의 "위" 한
    # 글자만 겹쳐도 60점). 로컬에서 rapidfuzz로 실측한 결과, 진짜 오타/축약 케이스("아이위"→"아이유",
    # "블핑"→"블랙핑크" 등)는 전부 66.67점 이상인 반면, 이런 무관한 오탐(이 케이스, 그리고 실제
    # 유명 아티스트 "지드래곤"이 "있지"로 잘못 교정되는 것도 같은 원인으로 새로 발견함)은 정확히
    # 60.0점에 몰려있어서 65로 올리면 기존 정상 케이스는 그대로 두고 이 둘을 걸러낼 수 있음을 확인.
    # 참고로 짧은 후보 이름이 검색어에 그대로 부분 문자열로 포함되는 경우(예: "제니퍼 로렌스"→"제니")는
    # 90점까지도 나와서 점수 조정만으로 완전히 막을 순 없음 — 실사용 중 이런 사례가 실제로 보고되면
    # 그때 추가 규칙(길이 비율 등)을 고려. 이 매치가 실패하면 artist_matches가 비어서, 아래 §53 AI
    # 폴백까지 정상적으로 넘어갈 수 있게 됨(전엔 "위너"로 잘못 매치돼서 AI 폴백 자체가 스킵됐었음).
    corrected_artist_name = None
    effective_artist_query = q
    if HANGUL_PATTERN.search(q):
        match = fuzzy_process.extractOne(q, KNOWN_KOREAN_ARTIST_NAMES, score_cutoff=65)
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

    artists = _build_artist_results(artist_matches)

    track_data = lastfm_get({"method": "track.search", "track": q, "limit": 8})
    track_matches = track_data.get("results", {}).get("trackmatches", {}).get("track", [])
    tracks = _build_track_results(track_matches)

    # 아티스트/곡 둘 다 하나도 못 찾았고, 띄어쓰기가 하나도 없는 한글 검색어라면(§45) —
    # Last.fm 자체가 한글 띄어쓰기에 민감해서("꽃이피고지듯이"는 0건, "꽃이 피고 지듯이"는
    # 정상적으로 찾아지는 걸 직접 확인함) PyKoSpacing으로 교정한 문자열로 한 번만 더 시도.
    # 원래 검색어로 이미 뭔가 찾았으면 굳이 재시도하지 않음(정확한 조건 우선, 없을 때만 넓히는
    # 기존 폴백 패턴, [[학습노트 26번]]과 같은 원칙).
    # (§52) 위 한글 교정과 똑같은 문제가 영문 검색어("thatthat")에서도 실제로 발견됨 — 유명한
    # 곡("That That", 싸이 & 슈가)인데도 띄어쓰기를 빼면 Last.fm이 전혀 무관한 결과로 채움.
    # 한글이면 PyKoSpacing, 아니면 wordninja로 교정 — 둘 다 같은 재시도 로직을 공유함.
    corrected_spacing_query = None
    if not artists and not tracks and " " not in q:
        if HANGUL_PATTERN.search(q):
            corrected_spacing_query = _correct_korean_spacing(q)
        else:
            corrected_spacing_query = _correct_english_spacing(q)
        if corrected_spacing_query:
            retry_artist_data = lastfm_get({"method": "artist.search", "artist": corrected_spacing_query, "limit": 5})
            artists = _build_artist_results(
                retry_artist_data.get("results", {}).get("artistmatches", {}).get("artist", [])
            )
            retry_track_data = lastfm_get({"method": "track.search", "track": corrected_spacing_query, "limit": 8})
            tracks = _build_track_results(
                retry_track_data.get("results", {}).get("trackmatches", {}).get("track", [])
            )

    # (§53) 위 두 교정으로도 못 찾았으면 — 스페이싱 문제가 아니라 아예 다른 표기 체계(예: "댓댓"
    # 처럼 곡명을 한글 발음으로 옮겨 적은 경우)일 수 있어서 Claude Haiku에게 마지막으로 추측을
    # 맡김. quick-picks(§38)와 동일한 원칙: 모델이 준 아티스트/곡명을 그대로 믿지 않고 Last.fm에
    # 실제로 검색해서 진짜 있는 곡인지 재검증한 뒤에만 결과로 채택 — 모델이 지어낸 곡을 그대로
    # 내보내는 사고를 막기 위함. 재검증까지 실패하면(모델이 헛소리를 했거나 ANTHROPIC_API_KEY가
    # 없으면) 조용히 빈 결과 그대로 둠 — 검색 자체가 AI 키 유무에 좌우되면 안 되기 때문.
    # (§55) 원래는 "트랙이 하나도 없을 때만" AI 폴백을 돌렸는데, 위 쓰레기 필터 재설계에서 설명한
    # 것처럼 청취자 수로 완벽하게 걸러지지 않는 애매한 매치(패턴엔 안 걸리지만 신뢰하기엔 애매한
    # 항목)가 있으면 tracks가 비어있지 않아 AI 폴백 자체가 스킵되는 문제가 있었음. 그래서 "완전히
    # 없을 때"뿐 아니라 "있어도 전부 청취자 수가 낮아 신뢰도가 낮을 때"도 AI 폴백을 추가로 시도
    # 하도록 조건을 넓힘 — AI가 더 확실한 후보(청취자 수 많은 정식 트랙)를 찾으면 그걸 맨 앞에
    # 두고, 기존 저신뢰 트랙은 뒤에 남겨둠(완전히 지우지 않음 — AI도 못 찾으면 이거라도 보여주는
    # 게 아무것도 없는 것보단 나음).
    # (§56 버그 수정) 위 "청취자 수만으로" 신뢰도를 판단하는 로직에 실제 구멍이 있었음 — "동암역
    # 2번 출구" 검색 시 Last.fm이 "역 2번 출구"라는 부분 문자열이 겹치는 완전히 다른 곡("신풍역
    # 2번 출구 블루스", 장범준, 청취자 318명)을 매치시켰는데, 이 곡 하나가 청취자 100명을 넘긴다는
    # 이유만으로 전체 결과가 "신뢰할 만함"으로 판정돼 AI 폴백이 아예 스킵됨 — 정작 사용자가 찾던
    # 곡과는 전혀 다른 곡인데도. 청취자 수(인기도)와 검색어 관련성(진짜 찾던 곡이 맞는지)은 서로
    # 다른 축이라는 걸 놓쳤던 것 — 아무리 인기 있어도 검색어와 안 닮았으면 신뢰할 이유가 없음.
    # rapidfuzz로 검색어와 트랙명 사이의 문자열 유사도까지 같이 봐서, "인기도 O, 관련성 O"인
    # 트랙이 하나라도 있을 때만 신뢰하도록 수정.
    # 유사도 함수는 token_sort_ratio가 아니라 partial_ratio를 씀 — 로컬에서 직접 비교해보니
    # token_sort_ratio는 "동암역 2번 출구 (feat. ...)"(진짜 정답, 부가 정보가 붙어 토큰 수가
    # 늘어남)에 50점을 주고 "상수역 2번 출구"(가짜, 역 이름만 다름)엔 77.8점을 줘서 오히려
    # 가짜가 더 높게 나오는 역전 현상이 있었음. partial_ratio(부분 문자열 정렬 기반)는 검색어가
    # 트랙명에 그대로("...(feat...)"처럼 뒤에 뭔가 붙어도) 포함되는 진짜 정답엔 94~100점을 주고,
    # 글자 수는 비슷해도 핵심 단어(역 이름)가 다른 가짜엔 77.8~87.5점을 줘서 훨씬 잘 갈림 —
    # 90점을 기준으로 잡아 이 둘을 구분함.
    TRACK_CONFIDENCE_LISTENER_THRESHOLD = 100
    TRACK_QUERY_SIMILARITY_THRESHOLD = 90

    def _track_matches_query_well(track: dict) -> bool:
        listeners_ok = int(track.get("listeners") or 0) >= TRACK_CONFIDENCE_LISTENER_THRESHOLD
        similarity = fuzz.partial_ratio(q.lower(), (track.get("name") or "").lower())
        return listeners_ok and similarity >= TRACK_QUERY_SIMILARITY_THRESHOLD

    tracks_low_confidence = not tracks or not any(_track_matches_query_well(t) for t in tracks)
    print(f"[search-confidence] '{q}' -> tracks_low_confidence={tracks_low_confidence}, "
          f"tracks={[(t.get('artist'), t.get('name'), t.get('listeners')) for t in tracks]}")

    # (버그 수정) "2010년대 kpop"처럼 장르/연대 키워드로 보이는 검색어를 여기서 미리 판별해둠 —
    # 원래는 이 판별을 함수 맨 아래(§32 태그 검색 블록)에서만 했는데, 그러면 AI 폴백(§53)이 먼저
    # 실행돼서 "이 장르/연대에서 아무 곡 하나"를 억지로 추측해버림(예: "2010년대 kpop" -> AI가
    # "싸이 강남스타일" 한 곡만 추측해서 "검색된 곡"에 그 한 곡만 뜨고, 정작 원하는 "여러 곡 모음"인
    # tagTracks는 그 밑에 묻혀서 사용자가 못 보고 지나침). 장르/연대 키워드가 감지되면 "특정 한 곡"을
    # 찾는 게 아니라 "모음"을 원하는 검색이라고 보고, AI 단일곡 추측/유튜브 단일곡 폴백을 아예
    # 건너뛰고 곧바로 아래 tagTracks 태그 검색 결과를 쓰도록 함.
    genre_tag = _extract_genre_tag(q)
    decade_tag = _extract_decade_tag(q)
    is_genre_or_decade_query = bool(genre_tag or decade_tag)
    # (§57) 캐싱을 여기(호출부)에서 관리 — 검증 성공/실패에 따라 TTL을 다르게 줌. 검증까지
    # 성공한 추측은 90일(같은 검색어면 누가 다시 검색해도 Claude/Last.fm 재호출 없이 바로 재사용),
    # 실패했으면(모델이 헛짚었거나 카탈로그에 없거나) 1일로 짧게 — §51에서 이미 겪은 원칙("네거티브
    # 캐시는 짧게, 안 그러면 잘못된 결과가 오래 고정됨")을 이 캐시 레이어에도 동일 적용. 캐시
    # 히트면 Claude 호출도 Last.fm 재검증 호출도 전혀 안 나가서 비용이 완전히 0임.
    AI_FALLBACK_CACHE_TTL_SUCCESS = 60 * 60 * 24 * 90
    AI_FALLBACK_CACHE_TTL_FAILURE = 60 * 60 * 24 * 1
    # v2: (§58) 트랙 추측이 실패해도 "아티스트만이라도" 검증되면 검증됨=True로 캐싱하던 버그가
    # 있었음(유명 아티스트는 관련성과 무관하게 거의 항상 검증 통과) — 이 캐시는 /search 본체의
    # cache_key(v14)와 별개의 독립된 캐시 레이어라서, /search 쪽 버전을 올려도 여긴 안 올리면
    # 예전에 잘못 "검증됨=True"로 캐싱된 값이 새 로직을 안 타고 그대로 재사용됨 — 실제로 이
    # 문제로 §58 수정이 반영 안 되는 걸 라이브에서 직접 겪음. 중첩 캐시는 바깥쪽 캐시 키를
    # 올려도 안쪽 캐시가 별도로 살아있다는 걸 놓치기 쉬우니 앞으로 주의할 것.
    ai_guessed_query = None
    if not artists and tracks_low_confidence and not is_genre_or_decade_query:
        ai_fallback_cache_key = f"search-ai-fallback:v2:{q.lower().strip()}"
        cached_fallback = get_cached(ai_fallback_cache_key)
        if cached_fallback is not None:
            print(f"[search-ai-fallback] '{q}' -> 캐시된 결과 재사용(호출 없음), 검증됨={cached_fallback.get('verified')}")
            cached_tracks = cached_fallback.get("tracks") or []
            cached_artists = cached_fallback.get("artists") or []
            if cached_tracks:
                existing_keys = {(t["artist"].lower(), t["name"].lower()) for t in cached_tracks}
                remaining = [t for t in tracks if (t["artist"].lower(), t["name"].lower()) not in existing_keys]
                tracks = cached_tracks + remaining
            if cached_artists:
                artists = cached_artists
            ai_guessed_query = cached_fallback.get("ai_guessed_query")
        else:
            guess = _ai_guess_query(q)
            guessed_artist = (guess or {}).get("artist")
            guessed_track = (guess or {}).get("track")
            print(f"[search-ai-fallback] '{q}' -> AI 추측: artist={guessed_artist!r}, track={guessed_track!r}")
            result_tracks: list = []
            result_artists: list = []
            if guessed_artist or guessed_track:
                if guessed_track:
                    verify_track_data = lastfm_get({"method": "track.search", "track": guessed_track, "artist": guessed_artist or "", "limit": 5})
                    verified_tracks = _build_track_results(
                        verify_track_data.get("results", {}).get("trackmatches", {}).get("track", [])
                    )
                    # (§57 버그 수정) Last.fm track.search의 artist 파라미터는 엄격한 필터가 아니라
                    # 느슨한 힌트라, "아티스트는 맞는데 곡은 완전히 무관한" 결과가 그대로 검증을
                    # 통과해버리는 사고가 실제로 발생함 — AI가 "싸이 - 동암역 2번 출구"로 추측했는데
                    # 정작 검증 결과로 싸이의 "아름다운 이별 2", "Sleepless" 등 완전 무관한 곡들이
                    # 뜬 걸 라이브로 확인. "아티스트가 맞다"와 "그 아티스트의 그 곡이 맞다"는 다른
                    # 얘기라는 걸 놓쳤던 것 — Last.fm이 돌려준 곡 이름이 AI가 추측한 곡명과 실제로
                    # 닮았는지까지 partial_ratio로 한 번 더 확인해서, 이름이 안 닮은 매치는 버림.
                    verified_tracks = [
                        t for t in verified_tracks
                        if fuzz.partial_ratio(guessed_track.lower(), t["name"].lower()) >= 80
                    ]
                    if verified_tracks:
                        # 검증된 AI 추측 결과를 맨 앞에 두고, 기존 저신뢰 트랙 중 중복만 제거해서 뒤에 이어붙임
                        existing_keys = {(t["artist"].lower(), t["name"].lower()) for t in verified_tracks}
                        remaining = [
                            t for t in tracks
                            if (t["artist"].lower(), t["name"].lower()) not in existing_keys
                        ]
                        tracks = verified_tracks + remaining
                        ai_guessed_query = f"{guessed_artist} {guessed_track}".strip() if guessed_artist else guessed_track
                        result_tracks = verified_tracks
                    else:
                        print(f"[search-ai-fallback] '{q}' -> Last.fm 재검증 실패(트랙): '{guessed_artist} - {guessed_track}'와 이름이 닮은 매치를 못 찾음 (카탈로그에 없거나, 아티스트만 맞고 곡은 무관한 결과였음)")
                # (§58 버그 수정) 원래는 "트랙 추측이 실패하면" 아티스트만이라도 검증해서 보여주는
                # 로직이었는데, 이게 실제로 사고를 냄 — "동암역 2번 출구"에 대해 AI가 "싸이 - 강남역
                # 1번 출구"로 완전히 틀린 추측을 하고 트랙 검증엔 실패했는데도, "싸이"라는 아티스트
                # 자체는 워낙 유명해서 Last.fm에 당연히 존재하니까 이 아티스트 검증은 "성공"으로
                # 처리돼버려서, 검색과 전혀 무관한 "싸이" 아티스트 카드들이 화면에 뜨고 그게 90일
                # 검증됨=True로 캐싱까지 되는 사고로 이어짐. "아티스트가 실존한다"는 것과 "그 아티스트가
                # 이 검색어와 관련 있다"는 건 전혀 다른 얘기인데, 유명 아티스트는 거의 항상 존재
                # 자체는 참이라 이 구분이 없으면 사실상 검증이 무의미해짐(§57에서 트랙에 겪은 것과
                # 같은 종류의 문제). 그래서 이 아티스트 단독 검증은 "AI가 애초에 트랙 추측 자체를
                # 안 했을 때"(= 진짜로 아티스트 검색이라고 판단한 경우)만 시도하도록 좁힘 — 트랙을
                # 추측했는데 그게 틀렸으면, 아티스트만이라도 보여주지 말고 그냥 전체를 실패로 처리.
                if guessed_artist and not guessed_track:
                    verify_artist_data = lastfm_get({"method": "artist.search", "artist": guessed_artist, "limit": 5})
                    verified_artists = _build_artist_results(
                        verify_artist_data.get("results", {}).get("artistmatches", {}).get("artist", [])
                    )
                    if verified_artists:
                        artists = verified_artists
                        ai_guessed_query = guessed_artist
                        result_artists = verified_artists
                    else:
                        print(f"[search-ai-fallback] '{q}' -> Last.fm 재검증 실패(아티스트): '{guessed_artist}'를 Last.fm에서 못 찾음")

            verified_ok = bool(result_tracks or result_artists)
            ttl = AI_FALLBACK_CACHE_TTL_SUCCESS if verified_ok else AI_FALLBACK_CACHE_TTL_FAILURE
            set_cached(ai_fallback_cache_key, {
                "tracks": result_tracks,
                "artists": result_artists,
                "ai_guessed_query": ai_guessed_query,
                "verified": verified_ok,
            }, ttl=ttl)
            print(f"[search-ai-fallback] '{q}' -> 결과 캐싱함 (검증됨={verified_ok}, TTL={'90일' if verified_ok else '1일'})")

    # (§59) Last.fm(§45/§52 교정 포함) + AI 추측 재검증(§53/§57/§58)까지 다 실패했으면 — Last.fm
    # 카탈로그 자체에 이 곡이 없을 가능성이 높음("동암역 2번 출구" 라이브 진단으로 실제 확인).
    # 진짜 마지막 수단으로 유튜브 자체 검색을 시도 — Last.fm의 크라우드소싱 카탈로그보다 훨씬
    # 넓은 인덱스라 여기선 찾을 확률이 있음. Last.fm 정식 매칭이 아니라 "비검증" 결과라는 걸
    # `youtubeFallbackUsed` 플래그로 명시해서 프론트가 구분해서 보여줄 수 있게 함.
    youtube_fallback_used = False
    if not artists and tracks_low_confidence and not ai_guessed_query and not is_genre_or_decade_query:
        yt_result = _youtube_raw_query_search(q)
        if yt_result:
            youtube_track = {
                "name": yt_result["name"] or q,
                "artist": yt_result["artist"] or "알 수 없음",
                "listeners": None,
                "url": f"https://www.youtube.com/watch?v={yt_result['videoId']}",
                "image": f"https://i.ytimg.com/vi/{yt_result['videoId']}/hqdefault.jpg",
                "videoId": yt_result["videoId"],
            }
            existing_keys = {(t["artist"].lower(), t["name"].lower()) for t in tracks}
            if (youtube_track["artist"].lower(), youtube_track["name"].lower()) not in existing_keys:
                tracks = [youtube_track] + tracks
            youtube_fallback_used = True
            print(f"[search-youtube-fallback] '{q}' -> 유튜브 폴백 결과 사용: {youtube_track['artist']} - {youtube_track['name']} (videoId={yt_result['videoId']})")
        else:
            print(f"[search-youtube-fallback] '{q}' -> 유튜브에서도 못 찾음(또는 YOUTUBE_API_KEY 없음)")

    # "2010년대 kpop"처럼 아티스트/곡 이름이 아니라 장르·연대 키워드로 검색하는 경우 보완.
    # 검색어를 그대로 아티스트/곡 이름으로 못 찾을 때가 대부분이라, 두 태그(장르/연대)로 각각
    # 조회해서 합침 — Last.fm은 태그 하나만 받는 API라 "장르 AND 연대"처럼 엄밀하게 좁히진 못하고,
    # 둘 중 하나라도 걸리면 후보로 넣는 느슨한(OR에 가까운) 매칭임. 이 결과는 "정확히 이 곡을
    # 찾겠다"는 목적이 아니라 무드 탐색과 같은 "둘러보기" 성격이라, 다른 둘러보기 목록과 동일하게
    # 가사 있는 곡만 걸러서 내려줌(검색 자체와는 별개 취급).
    # (genre_tag/decade_tag는 위에서 is_genre_or_decade_query 판별용으로 이미 추출해둠 — 재사용)
    #
    # (버그 수정) "2010년대 kpop"을 검색했더니 결과가 전부 서구 팝이고 케이팝이 하나도 안 보인다는
    # 지적 — 원래는 decade_tag("2010s") 후보를 다 채운 뒤에야 genre_tag("k-pop") 후보를 뒤에
    # 덧붙이는 순서였는데, Last.fm 이용자층이 서구권에 훨씬 많아서 "2010s" 태그 하나만으로도 가사
    # 있는 곡 15개가 이미 다 채워져버려 genre_tag 후보가 최종 목록에 들어갈 기회 자체가 없었음 —
    # "OR 매칭"이라던 의도와 달리 사실상 "먼저 채운 태그가 결과를 독식"하는 구조였음. 두 태그의
    # 후보 목록을 각각 따로 모은 뒤 하나씩 번갈아 섞어서(라운드로빈), 둘 다 있는 경우 최종 결과에
    # 골고루 섞이도록 수정.
    tag_tracks = []
    if genre_tag or decade_tag:
        seen = {(t["artist"].lower(), t["name"].lower()) for t in tracks}
        tag_candidate_lists = [_tag_top_tracks(tag, 30) for tag in filter(None, [genre_tag, decade_tag])]
        candidates = []
        for i in range(max((len(lst) for lst in tag_candidate_lists), default=0)):
            for lst in tag_candidate_lists:
                if i >= len(lst):
                    continue
                track = lst[i]
                key = (track["artist"].lower(), track["name"].lower())
                if key not in seen:
                    candidates.append(track)
                    seen.add(key)
        tag_tracks = _filter_tracks_with_lyrics(candidates, 15)
        print(f"[search-tag-tracks] '{q}' -> genre_tag={genre_tag!r}, decade_tag={decade_tag!r}, "
              f"원본 후보 {len(candidates)}개 -> 가사 필터 통과 {len(tag_tracks)}개")

    result = {
        "artists": artists,
        "tracks": tracks,
        "tagTracks": tag_tracks,
        "correctedArtistName": corrected_artist_name,
        "aiGuessedQuery": ai_guessed_query,
        "youtubeFallbackUsed": youtube_fallback_used,
    }
    set_cached(cache_key, result)

    if x_session_id:
        log_event(x_session_id, "search", q, result_count=len(artists) + len(tracks) + len(tag_tracks))
        push_search_history(x_session_id, q)

    return {**result, "cached": False}


@app.get("/recommend")
def recommend_by_artist(artist_name: str, x_session_id: Optional[str] = Header(default=None)):
    cache_key = f"recommend:v2:{artist_name.lower().strip()}"  # v2: 이미지 우선순위 변경(§31) 캐시 무효화
    cached = get_cached(cache_key)
    if cached is not None:
        if x_session_id:
            log_event(x_session_id, "recommend_click", artist_name, result_count=len(cached["tracks"]))
        return {**cached, "cached": True}

    # "추천도 둘러보는 목록이니 가사 있는 곡만" — 유사 아티스트/아티스트당 곡 수를 늘려 후보를
    # 넉넉히(최대 40) 모은 뒤, 가사 있는 곡만 걸러서 이전과 비슷한 체감 개수(15)로 자름.
    similar = lastfm_get({
        "method": "artist.getSimilar",
        "artist": artist_name,
        "limit": 8,
    })
    related_artists = similar.get("similarartists", {}).get("artist", [])

    tracks = []
    for artist in related_artists:
        top_tracks = lastfm_get({
            "method": "artist.getTopTracks",
            "artist": artist["name"],
            "limit": 5,
        })
        track_list = top_tracks.get("toptracks", {}).get("track", [])
        for track in track_list:
            tracks.append({
                "name": track["name"],
                "artist": _clean_artist_name(track["artist"]["name"]),
                "listeners": track.get("listeners"),
                "url": track.get("url"),
                "image": track_image(track),
            })

    # 국내 힙합 등 Last.fm에 "유사 아티스트" 데이터 자체가 없는 경우가 실제로 있음
    # (예: 김하온) — related_artists가 비어서 tracks도 비면, 완전히 빈 화면 대신
    # 같은 아티스트의 다른 인기곡이라도 "관련 항목"에 보여줌.
    if not tracks:
        own_top = lastfm_get({
            "method": "artist.getTopTracks",
            "artist": artist_name,
            "limit": 15,
        })
        track_list = own_top.get("toptracks", {}).get("track", [])
        for track in track_list:
            tracks.append({
                "name": track["name"],
                "artist": _clean_artist_name(track["artist"]["name"]),
                "listeners": track.get("listeners"),
                "url": track.get("url"),
                "image": track_image(track),
            })

    tracks = _filter_tracks_with_lyrics(tracks, 15)

    result = {"tracks": tracks}
    set_cached(cache_key, result)

    if x_session_id:
        log_event(x_session_id, "recommend_click", artist_name, result_count=len(tracks))

    return {**result, "cached": False}


@app.get("/artist-top-tracks")
def artist_top_tracks(artist_name: str, x_session_id: Optional[str] = Header(default=None)):
    """
    (§61) "검색해도 검색된 곡 말고는 다 똑같다, 유튜브 뮤직처럼 검색한 것과 관련된 곡이 홈에도
    떴으면 좋겠다"는 요청으로 추가. 검색 시 홈 화면의 "지금 인기 있는 곡"/"인기 아티스트"처럼
    검색과 무관한 고정 섹션 대신, 검색한 아티스트 본인의 다른 인기곡으로 채우는 용도.

    `/recommend`와 헷갈리기 쉬운데 의도적으로 다른 엔드포인트 — `/recommend`는 `artist.getSimilar`로
    "비슷한 아티스트들"의 곡을 모으고(그 아티스트 데이터가 없으면 그제야 본인 곡으로 폴백), 이건
    처음부터 끝까지 그 아티스트 "본인"의 `artist.getTopTracks`만 씀. 검색 맥락에서 사용자가 원하는
    건 "이 아티스트와 비슷한 다른 아티스트"가 아니라 "이 아티스트의 다른 곡"이라는 좁고 명확한
    의도라서, 기존 엔드포인트를 재활용하지 않고 분리함.
    """
    cache_key = f"artist-top-tracks:v2:{artist_name.lower().strip()}"
    cached = get_cached(cache_key)
    if cached is not None:
        return {**cached, "cached": True}

    # (추가 수정) 라이브 확인 중 이 섹션이 그냥 안 뜨는 문제 발견 — track.search의 artist 파라미터는
    # 느슨한 힌트라 검색 결과 트랙의 artist 필드가 "싸이"처럼 Last.fm이 정식 아티스트 페이지로
    # 인식 안 하는 표기일 수 있는데, artist.getTopTracks는 정확한 아티스트명이 필요해서 여기서
    # "Artist not found" 에러가 나면 lastfm_get()이 HTTPException을 던져 그대로 500급으로 죽고
    # 있었음(§60에서 겪은 것과 같은 패턴). 실패해도 빈 목록으로 취급하고 로그를 남겨서, 다음에
    # 이 로그로 정확한 원인(진짜 아티스트 자체가 없는 건지, 표기 문제인지)을 확인할 수 있게 함.
    try:
        data = lastfm_get({
            "method": "artist.getTopTracks",
            "artist": artist_name,
            "limit": 30,  # 가사 필터로 걸러질 걸 감안해서 넉넉히 모아둠(§44와 동일 원칙)
        })
        raw_tracks = data.get("toptracks", {}).get("track", [])
    except HTTPException as e:
        print(f"[artist-top-tracks] '{artist_name}' artist.getTopTracks 실패(빈 결과로 처리): {e.detail}")
        raw_tracks = []

    print(f"[artist-top-tracks] '{artist_name}' -> Last.fm 원본 {len(raw_tracks)}곡")

    tracks = []
    for track in raw_tracks:
        tracks.append({
            "name": track["name"],
            "artist": _clean_artist_name(track["artist"]["name"]),
            "listeners": track.get("listeners"),
            "url": track.get("url"),
            "image": track_image(track),
        })

    # "둘러보기" 목적의 목록이라 가사 있는 곡만 걸러서 내려줌(§44와 동일 원칙, 검색 자체와는 별개 취급)
    tracks = _filter_tracks_with_lyrics(tracks, 15)
    print(f"[artist-top-tracks] '{artist_name}' -> 가사 필터 통과 {len(tracks)}곡")

    result = {"tracks": tracks}
    set_cached(cache_key, result)

    if x_session_id:
        log_event(x_session_id, "artist_top_tracks_view", artist_name, result_count=len(tracks))

    return {**result, "cached": False}


def _youtube_thumbnail_fallback(artist_name: str, track_name: str) -> Optional[str]:
    """
    "빠른 선곡"에서 iTunes+Last.fm 둘 다 실패한 곡(비공식/리믹스/쇼미더머니 참가곡처럼 정식
    음원 유통이 안 된 트랙 등)의 이미지를 마지막으로 보강하려고 추가. 유튜브 뮤직이 이런 곡도
    이미지가 뜨는 이유는 사실 "앨범 커버"가 아니라 그 곡이 올라간 유튜브 영상 자체의 썸네일을
    쓰기 때문 — 우리도 이미 재생 버튼용으로 유튜브 검색(`/youtube-search`)을 하고 있으니, 같은
    캐시 키(`youtube-search:{artist}:{track}`)를 그대로 재사용해서 이미지용으로도 활용함.
    이렇게 하면 (1) 이미 재생해서 캐싱된 곡은 API를 다시 안 부르고 캐시에서 바로 videoId를 꺼내
    쓸 수 있고, (2) 여기서 새로 검색해서 캐싱해두면 나중에 그 곡을 재생할 때도 `/youtube-search`가
    API를 다시 안 부르고 이 캐시를 그대로 씀 — 두 기능이 캐시를 공유해서 쿼터를 이중으로 안 씀.
    썸네일 자체(`i.ytimg.com/vi/{videoId}/...`)는 유튜브 API 쿼터를 안 쓰는 공개 정적 URL이라,
    videoId만 한 번 알아내면 이미지 조회 자체는 무료임.

    의도적으로 "빠른 선곡"에만 적용함 — "다시 듣기"(즐겨찾기 전체)처럼 곡 수가 많은 목록까지
    적용하면 캐시 안 된 곡마다 검색 API 호출(100유닛, 하루 한도 10,000유닛=약 100회)이 나가서
    하루 쿼터를 화면 하나 로드에 다 쓸 수도 있음 — 사용자와 상의 후 범위를 이렇게 좁힘.
    """
    if not YOUTUBE_API_KEY:
        return None

    cache_key = f"youtube-search:{artist_name.lower().strip()}:{track_name.lower().strip()}"
    cached = get_cached(cache_key)
    if cached is not None:
        video_id = cached.get("videoId")
        return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg" if video_id else None

    try:
        res = requests.get(YOUTUBE_SEARCH_URL, params={
            "part": "snippet",
            "type": "video",
            "maxResults": 1,
            "q": f"{artist_name} {track_name}",
            "key": YOUTUBE_API_KEY,
        }, timeout=3)
        if res.status_code != 200:
            print(f"[youtube-thumbnail-fallback] {artist_name} - {track_name}: 상태코드 {res.status_code}")
            return None
        items = res.json().get("items", [])
        video_id = items[0]["id"]["videoId"] if items else None
    except Exception as e:
        print(f"[youtube-thumbnail-fallback] {artist_name} - {track_name}: 예외 발생 - {e}")
        return None

    # /youtube-search와 정확히 같은 스키마({"videoId": ...})로 캐싱해야 두 기능이 캐시를 호환해서 씀
    set_cached(cache_key, {"videoId": video_id}, ttl=YOUTUBE_SEARCH_CACHE_TTL_SECONDS)
    return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg" if video_id else None


# (§57) 캐싱 위치를 이 함수 안에서 호출부(search())로 옮김 — 원래는 여기서 "모델이 준 추측
# 자체"만 보고 캐싱해서, 검증(Last.fm 재확인)까지 성공했는지 여부와 무관하게 항상 같은 90일
# TTL이 붙었음. 문제는 모델이 헛다리(예: "동암역 2번 출구"를 엉뚱하게 "싸이"로 추측)를 짚어도
# 그 잘못된 추측이 그대로 90일 동안 고정된다는 것 — §51에서 이미 겪은 "네거티브 캐시는 짧게"
# 원칙과 똑같은 문제가 이 캐시 레이어에도 있었던 것. 검증 성공/실패를 아는 건 호출부라서,
# 캐싱 책임 자체를 호출부로 옮기고 이 함수는 "Claude 호출"만 순수하게 담당하도록 정리함.
def _ai_guess_query(q: str) -> Optional[dict]:
    """
    (§53) 검색이 정확한 검색어/띄어쓰기 교정(§45, §52)까지 다 실패했을 때 쓰는 마지막 수단.
    "댓댓"(That That의 한글 발음 표기)처럼 스페이싱 문제가 아니라 아예 다른 표기 체계(발음 전사,
    줄임말, 오타 등)라 규칙 기반으로는 못 잡는 경우를 위해, Claude Haiku에게 "사용자가 실제로
    찾으려던 곡이 뭘지" 추측을 받음. quick-picks(§38)와 똑같은 원칙 적용: 모델의 추측을 그대로
    믿지 않고, 호출한 쪽(search())에서 Last.fm에 실제로 존재하는지 재검증한 뒤에만 결과로 씀 —
    모델이 지어낸 곡을 그대로 내보내는 사고를 막기 위함. 캐싱은 이 함수가 아니라 호출부에서
    검증 결과까지 포함해서 함(§57 참고).
    """
    if not ANTHROPIC_API_KEY:
        return None

    prompt = f"""음악 스트리밍 앱에서 사용자가 다음과 같이 검색했는데 아무 결과도 못 찾았어: "{q}"

사용자가 실제로 찾으려던 곡을 추측해줘. 띄어쓰기가 빠졌거나, 발음을 한글로 옮겨 적었거나
(예: "댓댓" → "That That"), 줄임말이거나, 오타일 수 있어. 확신이 없어도 가장 그럴듯한 추측
하나를 줘. 다른 설명 없이 JSON 객체로만 답해줘. 형식: {{"artist": "아티스트명", "track": "곡명"}}"""

    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        message = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=150,
            messages=[{"role": "user", "content": prompt}],
        )
        raw_text = message.content[0].text.strip()
    except Exception as e:
        print(f"[anthropic] 검색어 추측 요청 실패: {e}")
        return None

    if raw_text.startswith("```"):
        raw_text = raw_text.strip("`")
        if raw_text.startswith("json"):
            raw_text = raw_text[4:]
        raw_text = raw_text.strip()

    try:
        guess = json.loads(raw_text)
        if not isinstance(guess, dict):
            guess = {}
    except json.JSONDecodeError as e:
        print(f"[anthropic] 검색어 추측 JSON 파싱 실패: {e} / 원문: {raw_text[:200]}")
        guess = {}

    return guess


YOUTUBE_RAW_SEARCH_CACHE_TTL_SECONDS = 60 * 60 * 24 * 14  # 성공 시 14일 — /youtube-search(§28)와 동일 기준
YOUTUBE_RAW_SEARCH_NEGATIVE_CACHE_TTL_SECONDS = 60 * 60 * 24 * 1  # 실패 시 1일 (§51/§57과 동일한 네거티브 캐시 원칙)


def _youtube_raw_query_search(q: str) -> Optional[dict]:
    """
    (§59) Last.fm 자체 검색(§45/§52) + AI 추측 재검증(§53/§57/§58)까지 다 실패했을 때 쓰는 진짜
    마지막 수단. Last.fm은 사용자가 실제로 재생/스크로블한 기록으로 채워지는 크라우드소싱
    카탈로그라, "동암역 2번 출구"처럼 정식 발매는 됐지만 인지도가 낮은 곡은 아예 등록이 안 돼
    있을 수 있음(§55/§56/§58에서 실사용으로 확인) — 반면 유튜브는 업로드된 모든 영상이 검색
    대상이라 훨씬 넓은 인덱스이고, 사용자가 유튜브 뮤직에서 "댓댓"에 자동완성이 바로 뜨는 걸
    직접 확인한 것도 같은 이유(유튜브 자체 검색엔 이런 제약이 없음). Last.fm 메타데이터(청취자
    수, 정식 아티스트명 등) 없이 유튜브 영상 하나로 "비검증" 재생만 가능한 결과를 만들어 반환 —
    호출부(search())에서 이 결과를 "Last.fm 정식 매칭이 아니다"라고 구분해서 표시해야 함.

    비용 통제: /youtube-search(§28, 100유닛/회, 하루 한도 100회)와 같은 API를 쓰지만, 이건 검색
    자체가 아니라 "검색까지 다 실패했을 때"만 도달하는 마지막 수단이라 호출 빈도가 훨씬 낮음.
    검색어(q) 단위로 캐싱(성공 14일 / 실패 1일)해서 같은 검색어 재검색은 쿼터를 다시 안 씀.
    """
    if not YOUTUBE_API_KEY:
        return None

    cache_key = f"youtube-raw-search:{q.lower().strip()}"
    cached = get_cached(cache_key)
    if cached is not None:
        return cached or None  # 실패 캐시는 {}로 저장돼 있어서 재호출 없이 바로 None 반환

    try:
        res = requests.get(YOUTUBE_SEARCH_URL, params={
            "part": "snippet",
            "type": "video",
            "maxResults": 1,
            "q": q,
            "key": YOUTUBE_API_KEY,
        }, timeout=5)
        if res.status_code != 200:
            print(f"[search-youtube-fallback] '{q}' 요청 실패 ({res.status_code}): {res.text[:200]}")
            return None  # 할당량 초과 등 일시적 장애는 캐싱 안 함(§51과 동일 원칙 — 장애를 영구화하지 않기 위함)
        items = res.json().get("items", [])
    except Exception as e:
        print(f"[search-youtube-fallback] '{q}' 요청 예외: {e}")
        return None

    if not items:
        set_cached(cache_key, {}, ttl=YOUTUBE_RAW_SEARCH_NEGATIVE_CACHE_TTL_SECONDS)
        return None

    item = items[0]
    video_id = item["id"]["videoId"]
    title = item.get("snippet", {}).get("title", "")
    channel_title = item.get("snippet", {}).get("channelTitle", "")
    artist, name = _parse_youtube_music_title(title, channel_title)

    result = {"videoId": video_id, "artist": artist, "name": name}
    set_cached(cache_key, result, ttl=YOUTUBE_RAW_SEARCH_CACHE_TTL_SECONDS)
    return result


class AiQuickPickFavorite(BaseModel):
    artist: str
    name: str


class AiQuickPicksRequest(BaseModel):
    favorites: list[AiQuickPickFavorite]


AI_QUICK_PICKS_COUNT = 15  # 홈 화면 "빠른 선곡" 그리드 칸 수에 맞춤 (가로 스크롤 도입 후 9→15로 증량)
AI_QUICK_PICKS_FAVORITES_CAP = 20  # 프롬프트가 너무 길어지지 않게 즐겨찾기 목록을 이만큼으로 제한


@app.post("/quick-picks/ai")
def ai_quick_picks(payload: AiQuickPicksRequest, x_session_id: Optional[str] = Header(default=None)):
    """
    "빠른 선곡"을 즐겨찾기 목록 기반 LLM 추천으로 채움. 기존 artist.getSimilar 방식(§37)은
    즐겨찾기 중 아티스트 하나만 무작위로 골라 그 아티스트와 비슷한 다른 아티스트들을 넓히는
    방식이라 "취향 전체"를 보진 못했는데, 여기서는 즐겨찾기 목록 전체를 LLM에게 한 번에 보여주고
    새로운 곡을 추천받음 — 대신 모델이 실제로 존재하지 않는 곡을 지어낼 위험이 있어서, 추천받은
    "아티스트 - 곡" 각각을 Last.fm track.search로 재검증해서 실존이 확인된 곡만 통과시킨다
    (모델이 곡을 새로 만들어내게 하지 않고, "이름표만 받고 실제 데이터는 우리 쪽에서 다시 채우는" 방식
    — 존재하지 않는 곡을 그대로 내보내는 사고를 막기 위한 의도적 설계).
    """
    if not ANTHROPIC_API_KEY:
        raise HTTPException(status_code=503, detail="ANTHROPIC_API_KEY가 설정되지 않았습니다")
    if not payload.favorites:
        raise HTTPException(status_code=400, detail="즐겨찾기한 곡이 없습니다")

    # 비용 통제: 세션+날짜 단위로 캐싱해서 새로고침할 때마다 실제 LLM 호출이 나가지 않게 함
    # (즐겨찾기는 자주 안 바뀌니까 하루 한 번이면 충분하다는 판단 — 호출당 약 $0.002~0.003).
    # v2: 이미지 유튜브 썸네일 폴백(§39) 추가로 계산 로직이 바뀌어서 캐시 키 버전업.
    # v3: 가로 스크롤 UI 도입에 맞춰 개수를 9→15로 늘려서 또 한 번 버전업
    # (오늘 이미 저장된 옛 캐시가 9곡짜리 그대로 나가는 걸 막기 위함 — [[학습노트 36번]]과 같은 이유).
    cache_key = f"quick-picks-ai:v3:{x_session_id or 'anon'}:{date.today().isoformat()}"
    cached = get_cached(cache_key)
    if cached is not None:
        return {**cached, "cached": True}

    favorites = payload.favorites[:AI_QUICK_PICKS_FAVORITES_CAP]
    favorites_text = "\n".join(f"- {f.artist} - {f.name}" for f in favorites)

    prompt = f"""다음은 한 사용자가 즐겨찾기한 곡 목록이야:
{favorites_text}

이 취향을 바탕으로, 사용자가 좋아할 만한 새로운 곡을 {AI_QUICK_PICKS_COUNT * 2}개 추천해줘.
반드시 실제로 존재하는 곡이어야 하고, 위 목록에 이미 있는 곡은 추천에서 제외해줘.
다른 설명 없이 JSON 배열로만 답해줘. 형식: [{{"artist": "아티스트명", "track": "곡명"}}, ...]"""

    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        message = client.messages.create(
            model=ANTHROPIC_MODEL,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )
        raw_text = message.content[0].text.strip()
    except Exception as e:
        print(f"[anthropic] 추천 요청 실패: {e}")
        raise HTTPException(status_code=502, detail="AI 추천 요청에 실패했습니다")

    # 모델이 가끔 ```json 코드블록으로 감싸서 주는 경우가 있어서 벗겨냄
    if raw_text.startswith("```"):
        raw_text = raw_text.strip("`")
        if raw_text.startswith("json"):
            raw_text = raw_text[4:]
        raw_text = raw_text.strip()

    try:
        suggestions = json.loads(raw_text)
    except json.JSONDecodeError as e:
        print(f"[anthropic] JSON 파싱 실패: {e} / 원문: {raw_text[:300]}")
        raise HTTPException(status_code=502, detail="AI 추천 응답을 해석하지 못했습니다")

    seen = {(f.artist.lower().strip(), f.name.lower().strip()) for f in favorites}
    tracks = []
    for item in suggestions:
        if len(tracks) >= AI_QUICK_PICKS_COUNT:
            break
        if not isinstance(item, dict):
            continue
        artist = str(item.get("artist", "")).strip()
        track_name = str(item.get("track", "")).strip()
        if not artist or not track_name:
            continue
        key = (artist.lower(), track_name.lower())
        if key in seen:
            continue

        # 모델이 지어낸(존재하지 않는) 곡일 수 있으니, Last.fm track.search로 실제 존재 여부와
        # 정확한 메타데이터(청취자 수, 정식 아티스트명 등)를 다시 조회해서 검증한다.
        try:
            search_data = lastfm_get({"method": "track.search", "track": track_name, "artist": artist, "limit": 1})
        except HTTPException:
            continue
        matches = search_data.get("results", {}).get("trackmatches", {}).get("track", [])
        if not matches:
            continue
        match = matches[0]
        matched_artist = _clean_artist_name(match.get("artist", ""))
        matched_key = (matched_artist.lower(), match["name"].lower())
        if matched_key in seen:
            continue
        seen.add(key)
        seen.add(matched_key)

        image = resolve_track_image(matched_artist, match["name"], match.get("image", []))
        if not image:
            # iTunes/Last.fm 둘 다 실패한 곡(비공식 발매/쇼미더머니류)은 유튜브 영상 썸네일로 마지막 보강
            image = _youtube_thumbnail_fallback(matched_artist, match["name"])

        tracks.append({
            "name": match["name"],
            "artist": matched_artist,
            "listeners": match.get("listeners"),
            "url": match.get("url"),
            "image": image,
        })

    result = {"tracks": tracks}
    set_cached(cache_key, result, ttl=60 * 60 * 24)  # 하루 — 캐시 키의 날짜 단위와 의미를 맞춤

    if x_session_id:
        log_event(x_session_id, "quick_picks_ai", "", result_count=len(tracks))

    return {**result, "cached": False}


SIMILAR_TRACKS_RAW_CAP = 40  # 가사 필터로 걸러질 걸 감안해서, 후보 자체는 이만큼 넉넉히 모아둠
# (§48) 원래 15였는데, "다음 트랙 큐를 눌러서 곡을 바꿀 때마다 목록이 계속 늘어나는 게 어색하다,
# 처음부터 많이 나오게 할 수 없냐"는 피드백으로 25로 올림 — 프론트 이어붙이기(§47) 로직
# 덕분에 첫 호출부터 큐가 훨씬 꽉 차 보이고, 최대치(프론트 MAX_QUEUE_SIZE=40)까지도 이어붙이기
# 한두 번이면 도달함. 너무 크게 올리지 않은 이유는 아래 이미지 리졸브 비용과 직결되기 때문.
SIMILAR_TRACKS_FINAL_COUNT = 25  # 가사 있는 곡만 걸러낸 뒤 큐에 실제로 담을 개수


@app.get("/similar-tracks")
def similar_tracks(artist: str, track: str, x_session_id: Optional[str] = Header(default=None)):
    """
    미니 플레이어 "다음 트랙" 자동 재생 큐용. "유튜브 뮤직처럼 지금 듣는 곡이랑 비슷한 곡을
    계속 이어서 틀어줬으면 좋겠다"는 피드백으로 추가 — 곡이 끝나면 프론트가 이 목록의
    맨 앞 곡으로 자동 재생을 이어감(app/page.tsx의 handleTrackEnded).

    track.getSimilar(이 곡과 비슷한 곡)를 우선 쓰고, 결과가 부족하면(케이팝/국힙처럼 트랙 단위
    유사곡 데이터 자체가 빈약한 경우가 실제로 있음 — /recommend와 같은 한계) artist.getSimilar로
    비슷한 아티스트를 찾아 그 아티스트들의 인기곡으로 보충함(완전히 비었을 때만이 아니라, 트랙
    기반 결과가 적을 때도 같이 섞어서 큐가 너무 짧아지지 않게 함) — /recommend의 폴백과 같은 패턴.

    (§46) 재생 중인 아티스트 이름만으로 artist.getSimilar를 부르면, 그 이름을 쓰는 완전히
    다른 동명이인으로 잘못 매칭되는 경우를 실제로 발견함 — 예: 오디션 프로그램에서 "꽃이 피고
    지듯이"를 리메이크한 "Hanz"로 조회했더니, 노르웨이 칠합 프로듀서 "Hanz"(청취자 12만명)의
    유사 아티스트(전혀 무관한 장르)가 나옴. 청취자 수 격차나 장르 태그로는 이 오매칭을 구분할
    방법이 없었음(원래 인기 아티스트도 곡 하나보다 아티스트 전체 청취자가 훨씬 많은 게 정상이라
    그 격차 자체가 신호가 안 됨). 대신 같은 제목의 다른 버전들(track.search, 아티스트 무관)
    중 가장 많이 들은 아티스트를 찾아서, 유사 아티스트 조회는 그 아티스트 이름으로 대신 함 —
    커버/리메이크 버전이 원곡보다 Last.fm 데이터가 빈약한 건 흔한 패턴이라, 더 잘 알려진
    버전의 아티스트가 장르적으로 훨씬 신뢰할 만한 유사 아티스트 그래프를 갖고 있을 가능성이 큼.
    """
    # v5: (§60) Last.fm 후보가 하나도 없을 때 유튜브 "이 아티스트의 다른 곡"으로 채우는 폴백 추가
    # — 스키마/로직이 바뀌었으니 재적용(예전에 빈 목록으로 캐싱된 아티스트들이 새 폴백을 안 타고
    # 그대로 나가는 걸 막기 위함).
    cache_key = f"similar-tracks:v5:{artist.lower().strip()}:{track.lower().strip()}"  # v4: 최종 개수 15→25 증량 + 이미지 지연 리졸브로 변경(§48). v3: 대표 버전 아티스트로 유사 아티스트 조회하도록 변경(§46)
    cached = get_cached(cache_key)
    if cached is not None:
        return {**cached, "cached": True}

    seen = {(artist.lower().strip(), track.lower().strip())}  # 지금 재생 중인 곡 자체는 큐에서 제외
    tracks = []

    # (§48) 이미지 조회(iTunes 호출)를 여기서 바로 하지 않고 "_lastfm_images"에 원본 이미지
    # 배열만 잠깐 담아둠 — 최종적으로 큐에 남는 건 최대 40개 원시 후보 중 가사 필터를 통과한
    # SIMILAR_TRACKS_FINAL_COUNT(25)개뿐인데, 예전엔 그 필터링 전에 40개 전부의 이미지를
    # 미리 조회해서 정작 안 쓰이는 15곡어치 iTunes 호출이 낭비되고 있었음. 필터를 통과한
    # 후보만 나중에 한 번에 resolve_track_image()로 이미지를 채움 — 캐시(§48)와 합쳐지면
    # 한 번의 요청에서 iTunes를 부르는 횟수가 최대 40회에서 최대 25회로 줄어듦.
    def add_track(item):
        name = item.get("name")
        raw_artist_name = item["artist"]["name"] if isinstance(item.get("artist"), dict) else item.get("artist")
        artist_name = _clean_artist_name(raw_artist_name) if raw_artist_name else raw_artist_name
        if not name or not artist_name:
            return
        key = (artist_name.lower().strip(), name.lower().strip())
        if key in seen:
            return
        seen.add(key)
        tracks.append({
            "name": name,
            "artist": artist_name,
            "listeners": item.get("playcount") or item.get("listeners"),
            "url": item.get("url"),
            "image": None,
            "_lastfm_images": item.get("image", []),
        })

    # (§60 추가 수정) lastfm_get()은 Last.fm이 "Track not found"(error 6) 같은 정상적인 실패
    # 응답을 줘도 HTTPException을 던져서 엔드포인트 전체가 400으로 죽어버림 — §59 유튜브 폴백으로만
    # 존재하는 곡(예: "Dom" - "동암역 2번출구")은 애초에 Last.fm에 없는 게 당연한데, 그럴 때마다
    # 여기서 바로 죽어서 정작 아래에 이미 구현해둔 §60 유튜브 대체 폴백까지 도달을 못 하고 있었음.
    # 이 곡을 못 찾은 건 "결과가 없는" 정상 케이스로 취급해서 빈 목록으로 계속 진행하도록 함.
    try:
        data = lastfm_get({
            "method": "track.getSimilar",
            "artist": artist,
            "track": track,
            "limit": 10,
        })
        for item in data.get("similartracks", {}).get("track", []):
            add_track(item)
    except HTTPException as e:
        print(f"[similar-tracks] '{artist} - {track}' track.getSimilar 실패(빈 결과로 처리): {e.detail}")

    # 트랙 단위 유사곡이 없거나 적으면(예: 10곡 미만) 아티스트 단위로 보충 — "다음 트랙" 개수가
    # 아티스트마다 들쭉날쭉해지는 걸(어떤 곡은 9개, 어떤 곡은 없음) 막기 위해 항상 넉넉히 채워둠.
    if len(tracks) < SIMILAR_TRACKS_RAW_CAP:
        # 유사 아티스트 조회에 쓸 이름을 정함 — 기본은 지금 재생 중인 아티스트 그대로지만,
        # 같은 제목의 다른(더 많이 들은) 버전이 있으면 그쪽 아티스트로 바꿔서 오매칭 위험을 줄임(§46).
        expand_artist_name = artist
        try:
            versions_data = lastfm_get({"method": "track.search", "track": track, "limit": 10})
            versions = versions_data.get("results", {}).get("trackmatches", {}).get("track", [])

            def _listeners(v):
                try:
                    return int(v.get("listeners") or 0)
                except (TypeError, ValueError):
                    return 0

            best_version = max(versions, key=_listeners, default=None)
            if best_version and _listeners(best_version) > 0:
                best_artist_name = _clean_artist_name(best_version.get("artist", ""))
                if best_artist_name and best_artist_name.lower().strip() != artist.lower().strip():
                    expand_artist_name = best_artist_name
        except Exception as e:
            # 대표 버전 조회는 부가 기능 — 실패해도 원래 아티스트로 그냥 진행 (장애 격리)
            print(f"[similar-tracks] '{artist} - {track}' 대표 버전 조회 실패 (원래 아티스트로 진행): {e}")

        # (§60 추가 수정) 위 track.getSimilar와 같은 이유로 감쌈 — expand_artist_name 자체가
        # Last.fm에 없는 아티스트(예: "Dom")면 artist.getSimilar도 HTTPException을 던져서
        # 여기서 죽어버림. 이때도 빈 결과로 취급하고 §60 유튜브 폴백까지 내려가게 함.
        try:
            similar_artists_data = lastfm_get({
                "method": "artist.getSimilar",
                "artist": expand_artist_name,
                "limit": 6,
            })
            related_artists = similar_artists_data.get("similarartists", {}).get("artist", [])
            for related in related_artists:
                if len(tracks) >= SIMILAR_TRACKS_RAW_CAP:
                    break
                top_tracks = lastfm_get({
                    "method": "artist.getTopTracks",
                    "artist": related["name"],
                    "limit": 4,
                })
                for item in top_tracks.get("toptracks", {}).get("track", []):
                    add_track(item)
        except HTTPException as e:
            print(f"[similar-tracks] '{expand_artist_name}' artist.getSimilar 실패(빈 결과로 처리): {e.detail}")

    # "다음 트랙 큐도 가사 있는 곡만 나왔으면 좋겠다"는 요청으로, 위에서 넉넉히 모아둔 후보
    # (최대 40개) 중 가사가 실제로 있는 곡만 걸러서 최종 개수(25개)까지 자름.
    tracks = _filter_tracks_with_lyrics(tracks[:SIMILAR_TRACKS_RAW_CAP], SIMILAR_TRACKS_FINAL_COUNT)

    # (§60) Last.fm 유사곡/유사 아티스트 확장까지 다 돌려도 후보가 하나도 없으면 — 이 아티스트가
    # Last.fm 카탈로그 자체에 없는 경우일 가능성이 높음(§59의 유튜브 검색 폴백으로 재생된 곡에서
    # 특히 흔함, 예: "Dom" - "동암역 2번출구"). 이땐 유튜브에서 같은 아티스트명으로 검색해서 그
    # 아티스트의 다른 영상들로 큐를 채움 — 엄밀히는 "비슷한 곡"이 아니라 "이 아티스트의 다른 곡"
    # 이지만, 완전히 빈 화면보단 재생 연속성 측면에서 나음. 이 폴백은 위 가사 필터를 일부러 안
    # 씀 — 그 필터는 "둘러보기" 목적의 목록에만 적용한다는 원칙(§44)인데, 애초에 Last.fm/LRCLIB에
    # 데이터가 없는 아티스트라 가사 필터를 걸면 무조건 다 걸러져서 필터 자체가 무의미해짐.
    if not tracks and YOUTUBE_API_KEY:
        try:
            res = requests.get(YOUTUBE_SEARCH_URL, params={
                "part": "snippet",
                "type": "video",
                "maxResults": 8,
                "q": artist,
                "key": YOUTUBE_API_KEY,
            }, timeout=5)
            if res.status_code == 200:
                for item in res.json().get("items", []):
                    video_id = item.get("id", {}).get("videoId")
                    if not video_id:
                        continue
                    snippet = item.get("snippet", {})
                    yt_artist, yt_name = _parse_youtube_music_title(
                        snippet.get("title", ""), snippet.get("channelTitle", "")
                    )
                    key = (yt_artist.lower().strip(), yt_name.lower().strip())
                    if key in seen:
                        continue
                    seen.add(key)
                    tracks.append({
                        "name": yt_name,
                        "artist": yt_artist,
                        "listeners": None,
                        "url": f"https://www.youtube.com/watch?v={video_id}",
                        "image": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
                        "videoId": video_id,
                    })
                    if len(tracks) >= SIMILAR_TRACKS_FINAL_COUNT:
                        break
            else:
                print(f"[similar-tracks-youtube-fallback] '{artist}' 요청 실패 ({res.status_code})")
        except Exception as e:
            print(f"[similar-tracks-youtube-fallback] '{artist}' 요청 예외: {e}")
    else:
        # (§48) 필터를 통과해 실제로 큐에 남을 곡들만 이제 이미지를 채움 — add_track에서 미뤄둔 이유 참고.
        # 유튜브 폴백 트랙은 위에서 이미 image/videoId를 다 채워서 여기 해당 안 됨.
        for t in tracks:
            t["image"] = resolve_track_image(t["artist"], t["name"], t.pop("_lastfm_images", []))

    result = {"tracks": tracks}
    set_cached(cache_key, result)

    return {**result, "cached": False}


# 확장 재생 화면 "가사" 탭용. Genius API는 라이선스 문제로 가사 원문을 안 주고, YouTube Data API엔
# 애초에 가사 필드가 없어서(둘 다 사전 조사로 확인함) 계속 보류하던 기능이었는데, LRCLIB(lrclib.net)이
# 크라우드소싱된 가사를 API 키 없이 무료로 제공한다는 걸 확인해서 대신 붙임. 동기화 가사(syncedLyrics,
# LRC 타임스탬프 포함)가 있으면 그걸 우선 쓰고, 없으면 일반 가사(plainLyrics)로 폴백.
LRCLIB_SEARCH_URL = "https://lrclib.net/api/search"

# LRCLIB이 다 실패했을 때(4단계 폴백까지 다 시도해도 못 찾을 때) 시도하는 마지막 자동 소스.
# LRCLIB과 달리 "크라우드소싱 데이터를 자유롭게 재배포하겠다"고 명시된 서비스가 아니라, 어디서
# 가사를 모으는지 공식적으로 안 밝혀진 무료 API — 저작권 측면에서 LRCLIB만큼 깨끗하다고 말하긴
# 어려운 회색지대. "가사/추천이 이 사이트의 핵심이라 빈 곳을 최대한 줄이고 싶다"는 요청으로,
# 개인 포트폴리오 프로젝트 수준에서 감수 가능한 리스크로 판단하고 추가함(상업 서비스라면 안 썼을 것).
# 동기화(LRC) 가사는 안 주고 일반 텍스트만 줌.
LYRICS_OVH_URL = "https://api.lyrics.ovh/v1"
LYRICS_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30  # 30일 — 한 번 등록된 가사는 사실상 안 바뀜


def _first_lyrics_match(candidates):
    """
    여러 버전(라이브/리믹스/앨범별/Inst. 표기 오류 등)이 검색될 수 있는데, 인스트루멘탈이
    아니고 가사가 있는 후보 중 동기화 가사(syncedLyrics)가 있는 걸 최우선으로 고름 —
    없으면 일반 가사(plainLyrics)만 있는 첫 후보로 폴백.

    원래는 후보 목록 순서대로 "가사가 있으면(동기화든 일반이든) 그냥 첫 번째"를 썼는데,
    실사용 중(아이유 "라일락") 동기화 가사가 있는 후보가 검색 결과에 분명 있는데도 목록
    앞쪽에 plainLyrics만 있는 후보가 먼저 걸려서, 하이라이트/가사 클릭 이동이 하나도 동작
    안 하는 곡을 발견함 — LRCLIB 응답 순서가 아니라 "동기화 가사 유무"를 기준으로 우선순위를
    바꿔서 해결.
    """
    valid = [c for c in candidates if not c.get("instrumental") and (c.get("syncedLyrics") or c.get("plainLyrics"))]
    synced_match = next((c for c in valid if c.get("syncedLyrics")), None)
    return synced_match or (valid[0] if valid else None)


def _strip_title_annotations(title: str) -> str:
    # "(Prod. by BewhY)", "(Feat. ...)", "(Inst.)"처럼 프로듀서/피처링/버전 표기가 제목에 붙어있으면
    # 가사 DB에 등록된 "정식 제목"과 안 맞을 때가 있어서, 괄호/대괄호 안 내용을 다 떼고 한 번 더 검색함.
    cleaned = re.sub(r"[\(\[][^\)\]]*[\)\]]", " ", title)
    return re.sub(r"\s+", " ", cleaned).strip()


def _search_lrclib(params: dict):
    res = requests.get(LRCLIB_SEARCH_URL, params=params)
    if res.status_code != 200:
        print(f"[lyrics] LRCLIB 요청 실패 ({res.status_code}) params={params}: {res.text[:200]}")
        return None
    return _first_lyrics_match(res.json())


def _search_lyrics_ovh(artist: str, track: str) -> Optional[str]:
    """LRCLIB이 다 실패했을 때만 호출되는 마지막 자동 폴백. 못 찾으면(404) 그냥 None — 실패해도
    가사 탭 자체는 "찾지 못했어요" 안내로 조용히 넘어가야 하니 예외를 여기서 다 삼킴."""
    try:
        res = requests.get(f"{LYRICS_OVH_URL}/{quote(artist)}/{quote(track)}", timeout=4)
        if res.status_code != 200:
            return None
        lyrics = res.json().get("lyrics", "").strip()
        return lyrics or None
    except Exception as e:
        print(f"[lyrics-ovh] {artist} - {track}: 예외 발생 - {e}")
        return None


def _lyrics_override_key(artist: str, track: str) -> str:
    return f"lyrics-override:{artist.lower().strip()}:{track.lower().strip()}"


def _lyrics_blocklist_key(artist: str, track: str) -> str:
    """저작권자 삭제 요청(takedown) 대응용 영구 차단 목록. lyrics-override:와 별개 네임스페이스로
    두는 이유는, override(운영자가 직접 등록한 정상 가사)와 takedown(내려야 하는 가사)이 섞이면
    안 되기 때문 — 둘 다 있을 일은 거의 없지만, 있다면 takedown이 항상 이겨야 함."""
    return f"lyrics-blocklist:{artist.lower().strip()}:{track.lower().strip()}"


def _lookup_lyrics(artist: str, track: str) -> dict:
    """
    /lyrics 엔드포인트와, "가사 있는 곡만 보여주기" 필터(_filter_tracks_with_lyrics) 둘 다
    여기서 공유. 캐시(30일)를 그대로 재사용하기 때문에, 필터링 과정에서 한 번 확인된 곡은
    실제로 그 곡의 가사 탭을 열 때도 다시 LRCLIB을 안 부르고 캐시에서 바로 나감.

    저작권자 삭제 요청이 들어와 차단 목록(lyrics-blocklist:)에 올라간 곡은 override나 LRCLIB/
    lyrics.ovh 결과가 뭐든 상관없이 항상 "못 찾음"으로 취급 — 그래서 다른 모든 검사보다 먼저 확인함.
    (§44, "포트폴리오 프로젝트라 위법 여부가 불안하다"는 피드백으로, 회색지대 소스를 계속 쓰는 대신
    최소한 저작권자가 실제로 문제 삼으면 즉시 내릴 수 있는 대응 체계를 만들어둠.)

    수동으로 등록해둔 가사(lyrics-override:, TTL 없음)가 있으면 LRCLIB 조회 자체를 건너뛰고
    그걸 최우선으로 반환함 — "검색해서 어렵게 다시 찾아 들은 곡인데 가사가 없으면 아쉽다"는
    피드백으로 추가한 /lyrics/request(요청 남기기) + /lyrics/override(직접 등록) 흐름의 결과물.

    "최대한 많은 곡에서 가사가 나왔으면 좋겠다"는 요청으로, 한 번 실패해도 바로 포기하지 않고
    점점 느슨한 조건으로 최대 4단계까지 재시도함 — /similar-tracks, /recommend에서 쓰던 것과
    같은 "정확한 조건으로 먼저 찾고, 없으면 범위를 넓혀 재시도" 폴백 패턴.
    """
    if get_cached(_lyrics_blocklist_key(artist, track)) is not None:
        return {"found": False, "syncedLyrics": None, "plainLyrics": None, "takenDown": True}

    override = get_cached(_lyrics_override_key(artist, track))
    if override is not None:
        return override

    # v2: lyrics.ovh 폴백(§43) 추가로 "못 찾음" 판정 로직이 바뀌어서 캐시 키 버전업 —
    # 안 그러면 예전에 "못 찾음"으로 저장된 결과가 새 폴백을 시도도 안 해보고 그대로 나감
    # ([[학습노트 36번]]과 같은 이유).
    cache_key = f"lyrics:v2:{artist.lower().strip()}:{track.lower().strip()}"
    cached = get_cached(cache_key)
    if cached is not None:
        return cached

    match = _search_lrclib({"track_name": track, "artist_name": artist})

    # 1) 정확 매칭 후보가 전부 인스트루멘탈로 등록돼 있던 경우가 실제로 있었음(같은 곡의 다른
    #    등록본엔 가사가 있는데도) — 자유 검색어(q)로 다시 찾아봄.
    if match is None:
        match = _search_lrclib({"q": f"{artist} {track}"})

    cleaned_track = _strip_title_annotations(track)
    if match is None and cleaned_track and cleaned_track.lower() != track.lower():
        # 2) "(Prod. ...)"/"(Feat. ...)" 같은 부가 표기 때문에 제목이 안 맞을 수 있어서,
        #    그 부분을 떼어내고 정확 매칭 → 자유 검색 순서로 한 번 더 시도.
        match = _search_lrclib({"track_name": cleaned_track, "artist_name": artist})
        if match is None:
            match = _search_lrclib({"q": f"{artist} {cleaned_track}"})

    if match is None:
        # 3) LRCLIB 4단계를 다 실패해야만 시도하는 마지막 자동 폴백(§43) — 동기화 가사는 없고
        #    일반 텍스트만 주지만, "아예 없는 것"보다는 나음.
        ovh_lyrics = _search_lyrics_ovh(artist, track)
        if ovh_lyrics:
            result = {"found": True, "syncedLyrics": None, "plainLyrics": ovh_lyrics}
        else:
            result = {"found": False, "syncedLyrics": None, "plainLyrics": None}
    else:
        result = {
            "found": True,
            "syncedLyrics": match.get("syncedLyrics"),
            "plainLyrics": match.get("plainLyrics"),
        }

    set_cached(cache_key, result, ttl=LYRICS_CACHE_TTL_SECONDS)
    return result


@app.get("/lyrics")
def get_lyrics(artist: str, track: str):
    return _lookup_lyrics(artist, track)


# "검색해서 어렵게 다시 찾아 들은 곡인데 하필 가사가 없으면 아쉽다"는 피드백으로 추가.
# LRCLIB에 없는 곡을 자동으로 긁어올 방법은 없으니(스크래핑은 라이선스 위반), 대신
# "요청 남기기 → 운영자가 직접 가사를 구해서 수동 등록" 최소한의 파이프라인을 만듦.
ADMIN_SECRET = os.getenv("ADMIN_SECRET")


@app.post("/lyrics/request")
def request_lyrics(artist: str, track: str, x_session_id: Optional[str] = Header(default=None)):
    """
    가사 탭의 "가사 올려주세요" 버튼용. 요청 자체를 별도 테이블 없이 기존 이벤트 로깅
    파이프라인(MariaDB events 테이블, AARRR 분석에 쓰던 것과 같은 곳)에 새 이벤트 타입으로
    남김 — 나중에 "어떤 곡이 얼마나 요청됐는지" 같은 것도 같은 파이프라인으로 집계 가능.
    """
    if x_session_id:
        log_event(x_session_id, "lyrics_request", f"{artist} - {track}")
    return {"requested": True}


class LyricsOverrideRequest(BaseModel):
    artist: str
    track: str
    plain_lyrics: str
    synced_lyrics: Optional[str] = None


@app.post("/lyrics/override")
def add_lyrics_override(
    payload: LyricsOverrideRequest,
    x_admin_secret: Optional[str] = Header(default=None),
):
    """
    /lyrics/request로 쌓인 요청을 보고, 운영자가 직접 구한 가사를 수동으로 등록하는 엔드포인트.
    이 프로젝트엔 로그인/권한 체계가 아예 없어서(세션ID 기반 익명 사용자만 존재) 정식 인증
    대신 .env의 비밀값(ADMIN_SECRET)과 대조하는 최소한의 접근 제한만 걸어둠 — 실서비스라면
    관리자 로그인/역할 기반 권한이 필요하지만, 본인만 로컬에서 쓸 용도라 이 정도로 충분하다고
    판단한 의도적인 스코프 축소.
    LRCLIB 캐시(30일 TTL)와는 별도 네임스페이스(lyrics-override:, TTL 없음)에 저장하고,
    `_lookup_lyrics`가 이 값을 최우선으로 확인하므로 등록 즉시 가사 탭/필터 양쪽에 반영됨.

    원래는 artist/track/plain_lyrics/synced_lyrics를 전부 쿼리 파라미터로 받았는데,
    실제 가사 관리자 화면([[학습노트 42번]])을 만들면서 곡 하나의 가사 전체(보통 수백~수천자)를
    URL 쿼리스트링에 욱여넣으면 브라우저/서버의 URL 길이 제한에 걸릴 수 있다는 걸 깨달아서,
    JSON 바디로 받도록 바꿈 — 텍스트가 긴 필드는 쿼리 파라미터가 아니라 바디로 보내야 한다는
    사례로 남겨둠.
    """
    if not ADMIN_SECRET or x_admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="권한이 없어요.")

    result = {"found": True, "syncedLyrics": payload.synced_lyrics, "plainLyrics": payload.plain_lyrics}
    set_cached(_lyrics_override_key(payload.artist, payload.track), result, ttl=None)
    return result


class LyricsTakedownRequest(BaseModel):
    artist: str
    track: str


@app.post("/admin/lyrics/takedown")
def takedown_lyrics(
    payload: LyricsTakedownRequest,
    x_admin_secret: Optional[str] = Header(default=None),
):
    """
    저작권자(또는 그 대리인)가 실제로 삭제를 요청했을 때 쓰는 대응 엔드포인트. lyrics.ovh처럼
    출처가 불투명한 회색지대 소스를 쓰는 대신, 문제가 실제로 제기되면 즉시 내리고 다시는 자동으로
    안 뜨게 만드는 최소한의 notice-and-takedown 체계로 넣음(§44).

    수동 등록(override)과 LRCLIB/lyrics.ovh 조회 캐시를 둘 다 지우고, 영구 차단 목록에 올려서
    이후 어떤 소스가 뭘 찾아오든 `_lookup_lyrics`가 항상 "못 찾음"으로 취급하게 만듦 — 캐시만
    지우면 다음 조회 때 lyrics.ovh가 똑같은 걸 다시 찾아올 수 있어서 그것만으론 부족함.
    """
    if not ADMIN_SECRET or x_admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="권한이 없어요.")

    delete_cached(_lyrics_override_key(payload.artist, payload.track))
    delete_cached(f"lyrics:v2:{payload.artist.lower().strip()}:{payload.track.lower().strip()}")
    set_cached(_lyrics_blocklist_key(payload.artist, payload.track), {"blocked": True}, ttl=None)
    return {"takenDown": True}


@app.get("/admin/lyrics-requests")
def list_lyrics_requests(x_admin_secret: Optional[str] = Header(default=None)):
    """
    가사 관리자 화면용 — "가사 올려주세요"로 쌓인 요청 중 아직 처리(override 등록) 안 된 것만
    골라서 보여줌. artist_name 컬럼이 "아티스트 - 곡명" 문자열로 합쳐져 있어서(로깅 시점 포맷,
    " - " 구분자를 앞에서부터 한 번만 잘라 분리 — 아티스트명 자체에 " - "가 들어간 극소수 케이스는
    잘못 분리될 수 있다는 한계는 있음, 실사용 중 발견하면 아티스트/곡명을 처음부터 분리 저장하는
    방식으로 바꿀 것), 각각에 대해 이미 lyrics-override 캐시가 있는지 확인해서 있으면(=이미 처리됨)
    목록에서 제외함.
    """
    if not ADMIN_SECRET or x_admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="권한이 없어요.")

    rows = get_lyrics_requests()
    pending = []
    for row in rows:
        parts = row["artist_name"].split(" - ", 1)
        if len(parts) != 2:
            continue
        artist, track = parts[0].strip(), parts[1].strip()
        if get_cached(_lyrics_override_key(artist, track)) is not None:
            continue  # 이미 등록된 요청은 처리 목록에서 제외
        if get_cached(_lyrics_blocklist_key(artist, track)) is not None:
            continue  # 저작권 삭제 요청으로 차단된 곡은 "처리 대기"가 아니라 의도적으로 뺀 것
        pending.append({
            "artist": artist,
            "track": track,
            "requestCount": row["request_count"],
            "lastRequestedAt": row["last_requested_at"].isoformat() if row["last_requested_at"] else None,
        })
    return {"requests": pending}


LYRICS_FILTER_MAX_WORKERS = 12  # 후보 여러 곡의 가사 유무를 순차로 물어보면 느려서, 스레드풀로 동시에 확인
# (원래 8이었는데, 무드 탐색이 국내/해외 후보를 따로따로 필터링하면서 체감 속도가 느려진 걸 계기로
# 12로 올림 — LRCLIB이 못 찾은 곡은 4단계 폴백을 다 시도해야 해서 개별 조회가 은근히 오래 걸림)


def _lyrics_availability_map(tracks: list) -> dict:
    """
    여러 트랙의 가사 유무를 스레드풀로 동시에 확인해서 {(artist, name): found} 형태로 돌려줌.
    국내/해외처럼 후보를 그룹으로 나눠 각각 필터링해야 하는 곳에서, 그룹별로 따로 이 작업을
    돌리면(순차 실행) 시간이 배로 늘어나므로 — 전체 후보를 한 번에 합쳐 이 함수로 조회한 뒤
    그룹별로 결과만 나눠 쓰는 식으로 병렬성을 최대한 활용하는 게 핵심 (discover_by_mood 참고).
    """
    if not tracks:
        return {}

    pairs = [(t["artist"], t["name"]) for t in tracks]

    def check(pair):
        artist, name = pair
        return pair, _lookup_lyrics(artist, name).get("found", False)

    availability = {}
    with ThreadPoolExecutor(max_workers=LYRICS_FILTER_MAX_WORKERS) as executor:
        for pair, found in executor.map(check, pairs):
            availability[pair] = found
    return availability


def _filter_tracks_with_lyrics(tracks: list, limit: int) -> list:
    """
    "차트/추천처럼 둘러보는 목록엔 가사 있는 곡만 나왔으면 좋겠다"는 요청으로 추가.
    검색 결과에는 일부러 안 씀 — 사용자가 정확히 그 곡 제목으로 검색했는데 가사가 없다는
    이유로 결과에서 빠지면 "분명 검색했는데 왜 안 나오지"로 느껴질 수 있어서, 검색은 그대로
    전부 보여주고 차트/추천/무드 탐색/다음 트랙 큐처럼 "발견"이 목적인 목록에만 적용함.
    호출하는 쪽에서 필요한 개수(limit)보다 넉넉히 많은 후보를 미리 받아와야 함 — 그중 실제로
    가사가 있는 곡만 골라서 최종 개수를 맞추는 방식이라, 후보가 적으면 필터 후 목록이 짧아짐.
    """
    if not tracks:
        return tracks
    availability = _lyrics_availability_map(tracks)
    filtered = [t for t in tracks if availability.get((t["artist"], t["name"]))]
    return filtered[:limit]


@app.get("/recent-searches")
def recent_searches(x_session_id: Optional[str] = Header(default=None)):
    """
    검색창 드롭다운용 '최근 검색' 목록. 분석용 이벤트 로그(MariaDB)가 아니라 Redis에
    세션별로 저장한 UI 전용 목록에서 가져옴 — 사용자가 지워도 분석 데이터는 안 건드리게
    의도적으로 분리함(자세한 이유는 cache.py의 push_search_history 주석 참고).
    로그인이 없어서 세션ID 기준으로만 조회 가능 — 세션ID가 없으면 빈 목록을 반환한다.
    """
    if not x_session_id:
        return {"queries": []}
    return {"queries": get_search_history(x_session_id)}


@app.delete("/recent-searches")
def delete_recent_search(q: str, x_session_id: Optional[str] = Header(default=None)):
    """드롭다운에서 특정 검색어 하나만 지움 (휴지통 버튼)."""
    if x_session_id:
        remove_search_history(x_session_id, q)
    return {"removed": q}


class RecentPlayRequest(BaseModel):
    artist: str
    track: str
    url: Optional[str] = None
    image: Optional[str] = None


@app.post("/recent-plays")
def record_recent_play(payload: RecentPlayRequest, x_session_id: Optional[str] = Header(default=None)):
    """
    (§49) 홈 화면 "다시 듣기" 섹션용 최근 재생 기록. 원래 이 섹션이 즐겨찾기 목록을 그대로
    보여줬는데, "즐겨찾기는 사이드바에 이미 따로 있는데 다시 듣기도 즐겨찾기를 보여주면
    중복 아니냐"는 지적을 받고 진짜 "최근에 재생 시작한 곡" 기록으로 바꿈. 프론트가 클릭
    시점이 아니라 유튜브 플레이어가 실제로 재생을 시작한 시점(handleActuallyPlaying)에
    호출 — 즐겨찾기 markOpened와 같은 신호를 재사용.
    """
    if not x_session_id:
        return {"recorded": False}
    push_recent_play(x_session_id, payload.artist, payload.track, payload.url, payload.image)
    return {"recorded": True}


@app.get("/recent-plays")
def list_recent_plays(x_session_id: Optional[str] = Header(default=None)):
    if not x_session_id:
        return {"tracks": []}
    # 프론트 Track 타입과 필드를 맞추려고 listeners를 null로 채워서 내려줌
    # (재생 기록엔 청취자 수 개념이 없어서 애초에 저장 안 함).
    tracks = [{**t, "listeners": None} for t in get_recent_plays(x_session_id)]
    return {"tracks": tracks}


def _tag_top_tracks(tag: str, limit: int) -> list:
    """
    (무드 조회 지연 수정) 원래 이미지(iTunes 우선 조회)를 후보 하나씩 순차로 처리했는데,
    discover_by_mood가 이 함수를 50개짜리로 부르다 보니 iTunes가 429/403으로 막히기 시작하면
    50번을 하나씩 기다리며 그대로 다 거쳐야 해서 무드 하나 조회에 십수 초씩 걸리는 문제가
    있었음(사용자가 "슬픔"/"잔잔한" 무드에서 화면이 멈춘 것처럼 느낀 원인). top_artists()와
    같은 패턴(ThreadPoolExecutor)으로 이미지 조회만 병렬화해서 대기 시간을 크게 줄임 —
    이미지가 여전히 iTunes 쪽에서 막혀 있으면 개별 요청은 여전히 실패하지만(그 곡은 이미지
    없이 표시), 전체 50곡을 순서대로 기다리지 않아도 되게 함.
    """
    data = lastfm_get({
        "method": "tag.getTopTracks",
        "tag": tag,
        "limit": limit,
    })
    track_list = data.get("tracks", {}).get("track", [])
    built = [
        {
            "name": track["name"],
            "artist": _clean_artist_name(track["artist"]["name"]),
            # tag.getTopTracks는 청취자 수를 안 줘서(태그 인기 랭킹만 줌) listeners는 비워둠
            "listeners": None,
            "url": track.get("url"),
        }
        for track in track_list
    ]
    with ThreadPoolExecutor(max_workers=10) as executor:
        images = list(executor.map(track_image, track_list))
    for item, image in zip(built, images):
        item["image"] = image
    return built


# (§63/§64 이어서 발견) "집중"이랑 "신나는"의 국내 결과가 완전히 똑같이 뜬다는 지적으로 원인 파악:
# Last.fm은 한국 아티스트에 대한 무드 태깅(study/party 등) 데이터가 거의 없어서, 국내 후보가
# 6곡 미만이면 무드와 무관한 "k-pop" 고정 인기 차트로 채우고 있었음 — 그 차트 자체가 거의
# 안 바뀌니 결과적으로 대부분의 무드에서 국내 쪽이 똑같은 목록으로 덮이는 문제였음.
# "이런 기본 기능이 안 되면 왜 쓰냐"는 정당한 지적을 받고, Last.fm 태그 데이터에 기대는 대신
# 무드별로 실제 어울리는 국내 곡을 직접 골라 상황에 맞는 폴백을 우선 쓰도록 바꿈. 노래 자체는
# 한 번 만들어둔 목록이라 취향에 안 맞으면 이 딕셔너리만 고치면 됨 — 실제 사용해보면서 다듬을 것.
CURATED_DOMESTIC_MOOD_TRACKS: dict[str, list[tuple[str, str]]] = {
    "workout": [
        ("BTS", "Fire"),
        ("BLACKPINK", "How You Like That"),
        ("ITZY", "DALLA DALLA"),
        ("(G)I-DLE", "TOMBOY"),
        ("Stray Kids", "God's Menu"),
        ("aespa", "Next Level"),
        ("NCT DREAM", "Hot Sauce"),
        ("ZICO", "Any Song"),
        ("BIGBANG", "BANG BANG BANG"),
        ("PSY", "GANGNAM STYLE"),
    ],
    "chill": [
        ("IU", "Through the Night"),
        ("Standing Egg", "오래된 노래"),
        ("Melomance", "선물"),
        ("Crush", "Beautiful"),
        ("DEAN", "instagram"),
        ("Zion.T", "양화대교"),
        ("Suzy", "Yes No Maybe"),
        ("Heize", "헤픈 우연"),
    ],
    "study": [
        ("IU", "Palette"),
        ("Epik High", "우산"),
        ("AKMU", "얼음들"),
        ("Sam Kim", "Make Up"),
        ("Suran", "Wine"),
        ("Crush", "Oasis"),
        ("Paul Kim", "안녕"),
        ("Lucy", "고래야"),
    ],
    "party": [
        ("TWICE", "Fancy"),
        ("BLACKPINK", "DDU-DU DDU-DU"),
        ("BTS", "Dynamite"),
        ("ITZY", "WANNABE"),
        ("SEVENTEEN", "Very Nice"),
        ("MOMOLAND", "BBoom BBoom"),
        ("EXID", "Up & Down"),
        ("Girls' Generation", "Gee"),
    ],
    "mellow": [
        ("IU", "Blueming"),
        ("Jung Seung Hwan", "헤어지자 말해요"),
        ("Sondia", "그대라는 시"),
        ("Kim Feel", "청춘"),
        ("Jannabi", "주저하는 연인들을 위해"),
        ("Kwon Jinah", "Feeling"),
    ],
    "sad": [
        ("Ailee", "I Will Show You"),
        ("Baek Yerin", "Square"),
        ("Kim Bum Soo", "보고 싶다"),
        ("IU", "eight"),
        ("Sam Kim", "Breathe"),
        ("Ben", "너를 사랑하고 있어"),
    ],
    "love": [
        ("Zion.T", "No Make Up"),
        ("Baekhyun", "UN Village"),
        ("Crush", "morning"),
        ("DAY6", "I Like You"),
        ("Taeyeon", "Fine"),
        ("Jonghyun", "Lonely"),
        ("IU", "Love Poem"),
    ],
    "driving": [
        ("Jang Beom June", "노래방에서"),
        ("Standing Egg", "drive"),
        ("Crush", "Rush Hour"),
        ("Peppertones", "도로 위에서"),
        ("Kim Dong Ryul", "그대가 이렇게 내게 오듯이"),
    ],
}


def _resolve_curated_tracks(pairs: list[tuple[str, str]]) -> list[dict]:
    """
    CURATED_DOMESTIC_MOOD_TRACKS의 (아티스트, 곡명) 쌍을 Last.fm track.search로 실제
    메타데이터(청취자 수/이미지/url)까지 채워서 반환. 곡 하나하나를 다시 검색하는 거라
    _resolve_curated_tracks 자체 결과를 캐싱해서, 같은 무드를 다시 조회할 때 Last.fm/iTunes를
    다시 안 부르게 함(get_ai_quick_picks의 track.search 검증 패턴과 동일).
    """
    resolved = []
    seen = set()
    for artist, track_name in pairs:
        cache_key = f"curated-track:v1:{artist.lower()}:{track_name.lower()}"
        cached_track = get_cached(cache_key)
        if cached_track is None:
            try:
                search_data = lastfm_get(
                    {"method": "track.search", "track": track_name, "artist": artist, "limit": 1}
                )
            except HTTPException:
                continue
            matches = search_data.get("results", {}).get("trackmatches", {}).get("track", [])
            if not matches:
                continue
            match = matches[0]
            matched_artist = _clean_artist_name(match.get("artist", ""))
            image = resolve_track_image(matched_artist, match["name"], match.get("image", []))
            if not image:
                image = _youtube_thumbnail_fallback(matched_artist, match["name"])
            cached_track = {
                "name": match["name"],
                "artist": matched_artist,
                "listeners": match.get("listeners"),
                "url": match.get("url"),
                "image": image,
            }
            # 큐레이션 목록은 코드 수정 전엔 안 바뀌니 일반 태그 캐시(보통 몇 시간~하루)보다
            # 길게 1주일 캐싱 — Last.fm/iTunes 호출을 그만큼 아낌.
            set_cached(cache_key, cached_track, ttl=60 * 60 * 24 * 7)
        key = (cached_track["artist"].lower(), cached_track["name"].lower())
        if key in seen:
            continue
        seen.add(key)
        resolved.append(cached_track)
    return resolved


@app.get("/discover-by-mood")
def discover_by_mood(tag: str, x_session_id: Optional[str] = Header(default=None)):
    """
    아티스트를 검색하지 않고도, 무드/상황 태그(예: chill, workout)만으로 인기곡을 보여줌.
    유튜브 뮤직처럼 "검색 없이 홈 화면에서 바로 탐색"하는 흐름을 위한 엔드포인트.
    Last.fm의 tag.getTopTracks는 그 태그가 붙은 곡 중 인기순 상위 곡을 반환함.

    "한국 노래랑 팝송을 구분하고 싶다"는 요청으로, 결과를 국내(domesticTracks)/해외
    (internationalTracks) 두 목록으로 나눠서 내려줌 — 자세한 판별 기준은 _is_domestic_artist 참고.
    """
    # 캐시 키 버전: v2는 국내/해외 분리(응답 스키마 변경, {"tracks":[...]} → domestic/international
    # 두 필드로 바뀌면서 옛 캐시가 KeyError로 500을 냈던 문제 수정). v3은 트랙 이미지 우선순위를
    # Last.fm→iTunes에서 iTunes→Last.fm으로 뒤집은 §31 변경분. v4는 국내 폴백을 무드 무관 k-pop
    # 차트에서 무드별 큐레이션 목록으로 바꾼 변경분 — 안 올리면 옛 k-pop 차트 결과가 캐시 만료
    # 전까지 계속 나감.
    cache_key = f"discover-by-mood:v4:{tag.lower().strip()}"
    cached = get_cached(cache_key)
    if cached is not None:
        if x_session_id:
            total = len(cached["domesticTracks"]) + len(cached["internationalTracks"])
            log_event(x_session_id, "mood_browse", tag, result_count=total)
        return {**cached, "cached": True}

    # /chart와 같은 이유로, 최종 개수를 채우기 위해 더 많이(50곡) 받아온 뒤 국내/해외로 나눔.
    candidates = _tag_top_tracks(tag, 50)

    domestic, international = [], []
    for track in candidates:
        (domestic if _is_domestic_artist(track["artist"]) else international).append(track)

    # Last.fm의 무드/장르 태그는 서구 팝 위주로 편향돼 있어서, 후보를 아무리 늘려도
    # 국내 곡이 하나도 안 걸리는 태그가 실제로 있음 — 이 경우 무드별로 직접 골라둔
    # CURATED_DOMESTIC_MOOD_TRACKS로 보충함(예전엔 여기서 "k-pop" 태그의 무드 무관 고정
    # 차트를 썼는데, 그러면 대부분의 무드에서 국내 쪽이 똑같은 목록으로 보이는 문제가 있었음).
    if len(domestic) < 6:
        seen = {(t["artist"].lower(), t["name"].lower()) for t in domestic}
        curated_pairs = CURATED_DOMESTIC_MOOD_TRACKS.get(tag.lower().strip(), [])
        for track in _resolve_curated_tracks(curated_pairs):
            key = (track["artist"].lower(), track["name"].lower())
            if key not in seen:
                domestic.append(track)
                seen.add(key)

        # 그래도 부족하면(큐레이션 목록에 없는 새 무드거나 검색이 다 실패한 경우) 예전처럼
        # k-pop 인기 차트로 마지막 보충 — 무드와 안 맞아도 완전히 빈 화면보단 낫다는 판단.
        if len(domestic) < 6:
            for track in _tag_top_tracks("k-pop", 30):
                key = (track["artist"].lower(), track["name"].lower())
                if key not in seen:
                    domestic.append(track)
                    seen.add(key)

    # 국내/해외를 따로따로 _filter_tracks_with_lyrics()에 넘기면 스레드풀 병렬 조회가 두 번
    # 순차로 도는 셈이라(첫 번째 그룹 다 끝나야 두 번째 그룹 시작) 체감 속도가 눈에 띄게
    # 느려짐 — "뜨긴 하는데 느리다"는 피드백으로, 후보를 합쳐서 한 번의 병렬 조회로 끝낸 뒤
    # 그 결과만 국내/해외로 다시 나누는 방식으로 바꿔서 대기 시간을 절반 가까이 줄임.
    availability = _lyrics_availability_map(domestic + international)
    domestic_tracks = [t for t in domestic if availability.get((t["artist"], t["name"]))][:10]
    international_tracks = [t for t in international if availability.get((t["artist"], t["name"]))][:10]

    result = {"domesticTracks": domestic_tracks, "internationalTracks": international_tracks}
    set_cached(cache_key, result)

    if x_session_id:
        total = len(domestic_tracks) + len(international_tracks)
        log_event(x_session_id, "mood_browse", tag, result_count=total)

    return {**result, "cached": False}


@app.get("/chart")
def top_chart(country: Optional[str] = None):
    """
    홈 화면 중앙에 검색/무드 선택 없이도 기본으로 채워둘 인기 차트.
    멜론(최신앨범/인기있어요), 유튜브 뮤직(맞춤 믹스)은 홈에 들어가자마자 곡이 떠 있는데
    우리 서비스는 그게 없어서 첫 화면이 비어 보인다는 피드백 반영.
    country가 없으면 Last.fm chart.getTopTracks(전체 서비스 글로벌 차트),
    country가 있으면 geo.getTopTracks(그 나라에서 인기 있는 곡)를 씀 — 뒤이어 홈 화면을
    "글로벌 차트"/"국내 차트" 여러 행으로 나눠 보여달라는 피드백에서 추가된 파라미터.
    세션과 무관하게 모두에게 같은 결과라 캐시 키도 세션 없이 전역(국가별)으로만 씀.
    """
    # v2: 이미지 우선순위 변경(§31) 캐시 무효화 — 안 그러면 카드마다 같은 아티스트 프로필
    # 사진이 반복되는 옛 캐시가 만료 전까지 계속 나감(실사용 중 발견).
    cache_key = f"chart:top-tracks:v2:{country.lower()}" if country else "chart:top-tracks:v2"
    cached = get_cached(cache_key)
    if cached is not None:
        return {**cached, "cached": True}

    # "차트는 둘러보는 목록이니 가사 있는 곡만 나왔으면 좋겠다"는 요청으로, 최종 10곡을
    # 채우기 위해 일부러 더 많이(30곡) 받아온 뒤 가사가 있는 곡만 걸러서 10곡으로 자름.
    FETCH_LIMIT = 30
    FINAL_COUNT = 10

    if country:
        data = lastfm_get({
            "method": "geo.getTopTracks",
            "country": country,
            "limit": FETCH_LIMIT,
        })
    else:
        data = lastfm_get({
            "method": "chart.getTopTracks",
            "limit": FETCH_LIMIT,
        })
    track_list = data.get("tracks", {}).get("track", [])
    tracks = [
        {
            "name": track["name"],
            "artist": _clean_artist_name(track["artist"]["name"]),
            "listeners": track.get("listeners"),
            "url": track.get("url"),
            "image": track_image(track),
        }
        for track in track_list
    ]
    tracks = _filter_tracks_with_lyrics(tracks, FINAL_COUNT)

    result = {"tracks": tracks}
    set_cached(cache_key, result)

    return {**result, "cached": False}


@app.get("/chart/artists")
def top_artists():
    """
    홈 화면 '인기 아티스트' 행 — 스포티파이 홈의 '인기 아티스트' 섹션 참고.
    Last.fm chart.getTopArtists는 태그/국가와 무관한 전체 서비스 인기 아티스트 랭킹.
    """
    cache_key = "chart:top-artists:v2"  # v2: 이미지 우선순위 변경(§31) 캐시 무효화
    cached = get_cached(cache_key)
    if cached is not None:
        return {**cached, "cached": True}

    data = lastfm_get({
        "method": "chart.getTopArtists",
        "limit": 10,
    })
    artist_list = data.get("artists", {}).get("artist", [])

    # "인기 아티스트 카드가 죄다 회색 원이다"는 피드백 — Last.fm에 이미지가 없으면
    # iTunes로 보완함(트랙 이미지와 같은 이유). 아티스트 수만큼 순차로 조회하면 느려서
    # 스레드풀로 동시에 확인.
    def resolve_artist_image(item):
        lastfm_image = best_image(item.get("image", []))
        if lastfm_image:
            return lastfm_image
        return fetch_itunes_artist_artwork(item["name"])

    with ThreadPoolExecutor(max_workers=10) as executor:
        images = list(executor.map(resolve_artist_image, artist_list))

    artists = [
        {
            "name": item["name"],
            "mbid": item.get("mbid"),
            "image": image,
            "listeners": item.get("listeners"),
        }
        for item, image in zip(artist_list, images)
    ]

    result = {"artists": artists}
    set_cached(cache_key, result)

    return {**result, "cached": False}


YOUTUBE_SEARCH_CACHE_TTL_SECONDS = 60 * 60 * 24 * 14  # 14일. 같은 곡의 대표 영상은 거의 안 바뀌고,
# YouTube Data API 검색은 호출당 100 유닛(일일 무료 할당량 10,000 유닛=하루 100번)이라 최대한 아껴 씀.


@app.get("/youtube-search")
def youtube_search(artist: str, track: str, x_session_id: Optional[str] = Header(default=None)):
    """
    트랙 카드의 '재생' 버튼용 — 아티스트+곡 이름으로 유튜브에서 가장 관련도 높은 영상 1개를 찾아
    videoId만 돌려줌. 프론트는 이 videoId로 사이트 안에 유튜브 iframe을 띄워서, Last.fm 자체 페이지로
    나가지 않고도(우리가 자체 오디오 스트리밍 라이선스는 없으니) 그 자리에서 바로 들을 수 있게 함.
    """
    if not YOUTUBE_API_KEY:
        raise HTTPException(status_code=503, detail="YOUTUBE_API_KEY가 설정 안 돼있어요.")

    cache_key = f"youtube-search:{artist.lower().strip()}:{track.lower().strip()}"
    cached = get_cached(cache_key)
    if cached is not None:
        if x_session_id:
            log_event(x_session_id, "play_track", f"{artist} - {track}")
        return {**cached, "cached": True}

    res = requests.get(YOUTUBE_SEARCH_URL, params={
        "part": "snippet",
        "type": "video",
        "maxResults": 1,
        "q": f"{artist} {track}",
        "key": YOUTUBE_API_KEY,
    })
    if res.status_code != 200:
        # 할당량 초과 등으로 실패해도 재생 버튼 자체가 죽으면 안 되니, 프론트에서 videoId=null을
        # "이 곡은 재생 못 함"으로 자연스럽게 처리하게 함 (장애 격리 원칙 재사용)
        print(f"[youtube-search] 요청 실패 ({res.status_code}): {res.text[:200]}")
        return {"videoId": None, "cached": False}

    items = res.json().get("items", [])
    video_id = items[0]["id"]["videoId"] if items else None

    result = {"videoId": video_id}
    set_cached(cache_key, result, ttl=YOUTUBE_SEARCH_CACHE_TTL_SECONDS)

    if x_session_id:
        log_event(x_session_id, "play_track", f"{artist} - {track}")

    return {**result, "cached": False}


YOUTUBE_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"
YOUTUBE_CHART_CACHE_TTL_SECONDS = 60 * 60 * 3  # 3시간
YOUTUBE_TITLE_SEPARATOR_PATTERN = re.compile(r"\s[-–]\s")


def _parse_youtube_music_title(title: str, channel_title: str) -> tuple:
    """
    유튜브 인기 급상승 영상 제목에서 아티스트/곡명을 최대한 나눠봄. Last.fm처럼 깔끔하게
    분리된 필드가 없어서 나온 절충안 — "아티스트 - 곡명" 형태면 그대로 나누고, 그 패턴이
    아니면 채널명을 아티스트로 대신 씀(공식 음악 채널은 아티스트명 그대로인 경우가 많음).
    완벽한 파싱은 아니라서, 제목 형식이 다른 영상은 아티스트/곡명이 부정확할 수 있음.
    """
    cleaned = _strip_title_annotations(title)
    parts = YOUTUBE_TITLE_SEPARATOR_PATTERN.split(cleaned, maxsplit=1)
    if len(parts) == 2 and parts[0].strip() and parts[1].strip():
        return _clean_artist_name(parts[0]), parts[1].strip()
    # 채널명 폴백 — 유튜브 자동 생성 "아티스트명 - Topic" 채널이 그대로 아티스트명이
    # 되지 않도록 접미사를 제거함(실사용 중 "LiSA - Topic"이 그대로 뜨는 걸 확인함).
    return _clean_artist_name(channel_title), cleaned.strip()


def _youtube_trending_request(region_code: str, limit: int, video_category_id: Optional[str]) -> list:
    params = {
        "part": "snippet,statistics",
        "chart": "mostPopular",
        "regionCode": region_code,
        "maxResults": limit,
        "key": YOUTUBE_API_KEY,
    }
    if video_category_id:
        params["videoCategoryId"] = video_category_id

    res = requests.get(YOUTUBE_VIDEOS_URL, params=params)
    if res.status_code != 200:
        print(f"[youtube-chart] 요청 실패 ({res.status_code}, region={region_code}, category={video_category_id}): {res.text[:200]}")
        return []

    tracks = []
    for item in res.json().get("items", []):
        snippet = item.get("snippet", {})
        video_id = item.get("id")
        artist, name = _parse_youtube_music_title(snippet.get("title", ""), snippet.get("channelTitle", ""))
        thumbnails = snippet.get("thumbnails", {})
        image = (
            thumbnails.get("high", {}).get("url")
            or thumbnails.get("medium", {}).get("url")
            or thumbnails.get("default", {}).get("url")
        )
        tracks.append({
            "name": name,
            "artist": artist,
            "listeners": item.get("statistics", {}).get("viewCount"),
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "image": image,
            "videoId": video_id,
        })
    return tracks


def _youtube_trending(region_code: str, limit: int) -> list:
    """
    chart=mostPopular + videoCategoryId(음악)는 지역/시점에 따라 결과가 아예 안 나오는
    경우가 있어서(실사용 중 "국내/해외 인기 급상승" 섹션이 통째로 빈 걸 확인함) — 음악
    카테고리로 먼저 시도하고, 비어 있으면 카테고리 필터 없이 한 번 더 시도함. 카테고리
    없이 받은 결과는 음악이 아닌 영상이 섞일 수 있다는 한계는 있지만, "섹션이 계속
    비어있는 것"보다는 나음(다른 기능에서도 써온 "부족하면 폴백" 원칙과 같은 맥락).
    """
    tracks = _youtube_trending_request(region_code, limit, video_category_id="10")
    if not tracks:
        tracks = _youtube_trending_request(region_code, limit, video_category_id=None)
    return tracks


@app.get("/youtube-chart")
def youtube_chart(region: str = "KR"):
    """
    홈 화면 "인기 급상승" 섹션용. 지금까지 홈 화면 차트/무드 탐색은 전부 Last.fm(크라우드소싱
    태그·스크로블 기반)에만 의존하고 있었는데, 정작 이미 연동해둔 YouTube Data API는
    재생 버튼(/youtube-search)에서만 쓰이고 있었음 — "유튜브 API를 가져왔는데 왜 쓰는 느낌이
    없냐"는 피드백을 받고, videos.list(chart=mostPopular)로 유튜브 실제 트렌딩 데이터를
    가져와 쓰는 엔드포인트를 추가함.

    search.list(/youtube-search, 호출당 100유닛, 하루 100회 한도)와 다르게 이 엔드포인트는
    훨씬 저렴함(part 2개 기준 대략 5유닛) — 캐싱을 걸어도 쿼터 걱정 없이 자주 갱신 가능.
    또 실제로 그 지역에서 지금 보고 있는 영상 기준이라, 아티스트 이름으로 국내/해외를
    추측하던 [[학습노트 29번]]의 휴리스틱과 달리 지역 구분이 정확함(regionCode=KR/US).
    """
    if not YOUTUBE_API_KEY:
        raise HTTPException(status_code=503, detail="YOUTUBE_API_KEY가 설정 안 돼있어요.")

    region_code = region.upper().strip()
    cache_key = f"youtube-chart:{region_code}"
    cached = get_cached(cache_key)
    if cached is not None:
        return {**cached, "cached": True}

    tracks = _youtube_trending(region_code, 15)
    result = {"tracks": tracks}
    set_cached(cache_key, result, ttl=YOUTUBE_CHART_CACHE_TTL_SECONDS)

    return {**result, "cached": False}
