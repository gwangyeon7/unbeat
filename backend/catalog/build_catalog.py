"""별칭표(catalog.json) 생성기 — 서버가 아니라 사람이 필요할 때 한 번 돌리는 스크립트.

사용법(backend 폴더의 venv로):
  backend/venv/bin/python backend/catalog/build_catalog.py

입력:
  1) main.py의 수동 아티스트 목록: KNOWN_KOREAN_ARTIST_NAMES, EXTRA_KOREAN_ARTIST_NAMES, KOREAN_ARTIST_NAME_OVERRIDES
  2) search_eval/queries.csv의 아티스트 정답("RIIZE|라이즈" -> 정식 RIIZE, 한글 라이즈)
  3) catalog/manual_seed.json: 직접 쓴 아티스트/곡 별칭(메테오 -> 창모 METEOR 등) — 항상 최우선, 덮어쓰지 않음
  4) catalog/seed_melon_*.json(멜론 차트 화면을 사람이 옮겨 적은 시드 4개): 아티스트 + 곡 + 한글 제목 별칭
  5) 자동 수집(공개 차트, 약관상 허용된 API만): 애플 뮤직 KR 차트 RSS, Last.fm 한국 차트(geo.getTopTracks),
     유튜브 KR 음악 인기 차트(겹침 신호로만). 수집 결과는 catalog/auto_collected.json에 누적(지우지 않음),
     소스별 상태는 catalog/source_check.md에 기록. 하루 1회 수동/예약 실행용 — 서버 시작/검색 요청 중엔 외부 호출 없음.
출력: catalog/catalog.json (search_catalog.py가 서버 시작 시 읽음)

여러 번 돌려도 결과가 같음(멱등): 생성 시각 같은 가변 값을 넣지 않고, 모든 목록을 정해진 순서로 정렬해서 씀.
(외부 조회 결과가 바뀌면 그만큼은 달라질 수 있음 — 정식 이름/이미지는 Redis에 캐싱되므로 연달아 돌리면 동일.)

외부 조회는 여기서만 함(서버의 검색 요청 경로에서는 안 함): 정식 이름은 main._resolve_official_korean_artist(Last.fm
별칭 + Deezer + iTunes, 키 불필요/기존 Last.fm 키), 대표곡은 Last.fm artist.getTopTracks, 이미지는 기존
resolve_track_image/resolve_artist_image(결과는 Redis에도 캐싱됨). 이미지를 JSON에 같이 저장하는 이유: 운영 서버는
Redis가 달라서 로컬 캐시를 못 쓰기 때문. Claude 같은 유료 API는 부르지 않음(한글 제목은 이미 캐시된 값만 씀).
"""
import csv
import json
import os
import re
import sys
import time

import requests
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
sys.path.insert(0, BACKEND)

import main  # noqa: E402  (기존 조회/캐시 함수 재사용)
from search_catalog import normalize  # noqa: E402

TRACKS_PER_ARTIST = 10  # /search 파이프라인의 SEARCH_TRACK_RESULT_LIMIT(10)과 같게
WORKERS = 4
# 대표곡에서 뺄 영상/방송형 제목(main._clean_top_tracks의 필터에 더해 search_eval의 영상 판정 기준과 맞춤)
EXTRA_VIDEO_TITLE = re.compile(
    r"방송|비하인드|킬링보이스|커버|\bcover\b|응원법|\blive\b|라이브|\bver\.?\b|\binst\.?\b|instrumental|\bEP\.\s*\d",
    re.IGNORECASE,
)
# 한글명으로 등록된 Last.fm 아티스트("아이유")는 곡 제목도 한글("라일락")이라, 곡이 충분하면 그쪽을 우선함
KO_LIST_MIN_TRACKS = 5
KO_LIST_MIN_LISTENERS = 1000
HANGUL = re.compile(r"[가-힣]")
SEED_FILES = ["seed_melon_top100.json", "seed_melon_top100_1119.json", "seed_melon_yearly_2025.json", "seed_melon_artists_1119.json", "seed_melon_artists_1119_b.json", "seed_melon_artists_1119_c.json", "seed_melon_artists_1119_d.json", "seed_melon_artists_1119_e.json", "seed_melon_artists_1119_f.json", "seed_melon_artists_1119_g.json", "seed_melon_artists_1119_h.json", "seed_melon_artists_1120.json", "seed_melon_ballad_1119.json", "seed_melon_dance_1119.json", "seed_melon_rap_1119.json", "seed_melon_rap_daily.json", "seed_melon_jpop_daily.json", "seed_melon_indie_daily.json"]
# 출처 우선순위: 높은 쪽 값만 덮어쓸 수 있음 — 수동 시드는 어떤 경우에도 덮어써지지 않음
PRIO_LIST, PRIO_MELON, PRIO_QUERIES, PRIO_MANUAL = 0, 1, 2, 3
# "#안녕", "그_냥", "조선힙합_official": 특수문자를 빼고 정규화하면 일반 단어("안녕", "그냥")가 돼서 검색을 가로챔 — 색인 안 함
UNINDEXABLE_NAME = re.compile(r"[#_]")
# 멜론 시드 _meta.suggested_aliases_confident 중 영어 일반 단어 — 별칭(비색인)으로만 두고 검색 색인엔 넣지 않음.
# "rose" 검색이 로제(ROSÉ)로 가로채지던 문제(2026-11-18). "로제", "ROSÉ"(악센트 포함 표기)는 그대로 색인됨.
CONFIDENT_ALIAS_STOPWORDS = {"rose"}

# ---- 자동 수집(2026-11-18) -------------------------------------------------------------------------------
# 우선순위: 수동(3) > 시험지(2) > 멜론(1) > 수동 목록(0) > 자동 수집. 자동 수집은 수동 목록 "아래"라 기존 어떤 값도
# 덮어쓰지 못하고, 자동 수집 별칭이 기존 별칭과 겹치면 자동 쪽만 빠짐(기존 검색 결과를 바꾸거나 모호하게 만들지 않음).
PRIO_AUTO = -1
AUTO_STORE_PATH = os.path.join(HERE, "auto_collected.json")
SOURCE_CHECK_PATH = os.path.join(HERE, "source_check.md")
AUTO_SNAPSHOT_TTL_SECONDS = 60 * 60 * 48  # 소스 응답을 날짜별로 캐싱 — 같은 날 다시 돌리면 외부 호출 없이 같은 결과
AUTO_CALL_DELAY_SECONDS = 1.5  # 소스 호출 사이 지연
APPLE_KR_CHART_URL = "https://rss.marketingtools.apple.com/api/v2/kr/music/most-played/100/songs.json"
# Last.fm geo.getTopTracks: "south korea"는 400(error 6, country param invalid), ISO 3166 이름은 정상 — 2026-11-18 실측
LASTFM_KR_COUNTRY = "korea, republic of"
YOUTUBE_CHART_LIMIT = 50  # videos.list(chart=mostPopular) 1회 = 쿼터 1유닛, 음악 카테고리(10)만(폴백 없음)
# 영상 제목형(MV, 직캠, 방송 클립, 커버, 라이브, 응원법 등)은 정식 곡이 아니라 제외
AUTO_VIDEO_TITLE = re.compile(
    r"\bM/?V\b|뮤직비디오|직캠|fancam|방송|커버|\bcover\b|라이브|\blive\b|응원법|performance|official video|"
    r"teaser|티저|\bshorts\b|\(4K\)|\|",
    re.IGNORECASE,
)
CALL_STATS = {"http_calls": 0, "youtube_units": 0, "lastfm_calls": 0}


def _today() -> str:
    return time.strftime("%Y-%m-%d")


def _daily(kind: str, key: str, fn):
    """생성기 안의 외부 조회 결과(이미지/정식 이름)를 날짜별로 메모 — 기존 캐시는 "못 찾음"을 30분만 두기 때문에,
    그대로 쓰면 같은 날 다시 돌려도 결과가 바뀜(멱등성 깨짐). 실패(None)도 그날은 그대로 두고 다음 날 다시 시도."""
    ck = f"build-daily:v1:{_today()}:{kind}:{key}"
    cached = main.get_cached(ck)
    if cached is not None:
        return cached.get("v")
    value = fn()
    main.set_cached(ck, {"v": value}, ttl=AUTO_SNAPSHOT_TTL_SECONDS)
    return value


def track_image(artist: str, title: str, images=None):
    return _daily("track-image", f"{normalize(artist)}:{normalize(title)}",
                  lambda: main.resolve_track_image(artist, title, images or []))


def _snapshot(source: str, fetch) -> dict:
    """소스 응답(가공 후)을 날짜별 Redis 스냅샷으로. 성공했을 때만 캐싱 — 실패는 다음 실행에서 다시 시도."""
    key = f"build-source:v1:{source}:{_today()}"
    cached = main.get_cached(key)
    if cached is not None:
        return {**cached, "from_cache": True}
    snap = fetch()
    if snap.get("tracks"):
        main.set_cached(key, snap, ttl=AUTO_SNAPSHOT_TTL_SECONDS)
    return {**snap, "from_cache": False}


def fetch_apple_kr() -> dict:
    """애플 뮤직 KR '인기곡' 차트 RSS(키 불필요). 가끔 200인데 본문이 비어 오는 경우가 있어 최대 3회 재시도."""
    out = {"status": None, "elapsed": 0.0, "tracks": [], "error": None, "attempts": 0}
    for attempt in range(3):
        if attempt:
            time.sleep(AUTO_CALL_DELAY_SECONDS * 2)
        out["attempts"] = attempt + 1
        CALL_STATS["http_calls"] += 1
        t0 = time.time()
        try:
            res = requests.get(APPLE_KR_CHART_URL, timeout=10)
            out["status"], out["elapsed"] = res.status_code, round(time.time() - t0, 2)
            if res.status_code != 200:
                out["error"] = f"HTTP {res.status_code}"
                continue
            results = res.json()["feed"]["results"]
        except Exception as e:
            out["elapsed"], out["error"] = round(time.time() - t0, 2), f"{type(e).__name__}: {str(e)[:100]}"
            continue
        out["error"] = None
        out["tracks"] = [{
            "title": r.get("name") or "", "artist": r.get("artistName") or "", "rank": i + 1,
            "image": (r.get("artworkUrl100") or "").replace("100x100bb", "600x600bb") or None,
        } for i, r in enumerate(results)]
        return out
    return out


def fetch_lastfm_kr() -> dict:
    """Last.fm 한국 차트. 키는 main.lastfm_get이 환경변수(LASTFM_API_KEY)로만 붙임 — 여기서 출력하지 않음."""
    out = {"status": None, "elapsed": 0.0, "tracks": [], "error": None}
    CALL_STATS["http_calls"] += 1
    CALL_STATS["lastfm_calls"] += 1
    t0 = time.time()
    try:
        data = main.lastfm_get({"method": "geo.getTopTracks", "country": LASTFM_KR_COUNTRY, "limit": 100})
        out["status"] = 200
    except main.HTTPException as e:
        out.update(status=e.status_code, error=str(e.detail)[:100], elapsed=round(time.time() - t0, 2))
        return out
    out["elapsed"] = round(time.time() - t0, 2)
    out["tracks"] = [{"title": t.get("name") or "", "artist": (t.get("artist") or {}).get("name") or "",
                      "rank": i + 1, "image": None} for i, t in enumerate(data.get("tracks", {}).get("track", []))]
    return out


def fetch_youtube_kr() -> dict:
    """유튜브 KR 음악 인기 차트 — 기존 main._youtube_trending_request 재사용(1회, 쿼터 1유닛). 키가 없으면 건너뜀."""
    out = {"status": None, "elapsed": 0.0, "tracks": [], "error": None}
    if not main.YOUTUBE_API_KEY:
        out["error"] = "YOUTUBE_API_KEY 없음 — 건너뜀"
        return out
    CALL_STATS["http_calls"] += 1
    CALL_STATS["youtube_units"] += 1
    t0 = time.time()
    try:
        items = main._youtube_trending_request("KR", YOUTUBE_CHART_LIMIT, "10")
    except Exception as e:
        out.update(error=f"{type(e).__name__}: {str(e)[:100]}", elapsed=round(time.time() - t0, 2))
        return out
    out["elapsed"] = round(time.time() - t0, 2)
    # 기존 함수가 실패(비 200)면 빈 목록을 돌려주므로 상태코드는 결과 유무로만 알 수 있음
    out["status"] = 200 if items else "실패(빈 응답 — 서버 로그 참고)"
    out["tracks"] = [{"title": t.get("name") or "", "artist": t.get("artist") or "", "rank": i + 1, "image": None}
                     for i, t in enumerate(items)]
    return out


AUTO_SOURCES = [("apple", fetch_apple_kr), ("lastfm", fetch_lastfm_kr), ("youtube", fetch_youtube_kr)]


def _primary_artist(name: str) -> str:
    """"A2O & A2O LITE", "Panda Gomm & 양홍원", "A, B" -> 첫 번째(대표) 아티스트."""
    return re.split(r"\s*(?:,|&| x | X |feat\.?|Feat\.?)\s*", name or "")[0].strip()


def collect_auto_sources() -> tuple:
    """소스 3개를 차례로(사이에 지연) 가져와 영상 제목형을 빼고, 누적 파일을 갱신. 반환: (누적 항목 목록, 소스별 리포트)."""
    reports, today_items = {}, []
    for i, (name, fetch) in enumerate(AUTO_SOURCES):
        if i:
            time.sleep(AUTO_CALL_DELAY_SECONDS)
        snap = _snapshot(name, fetch)
        kept, excluded = [], []
        for t in snap.get("tracks", []):
            if not t["title"] or not t["artist"]:
                continue
            if AUTO_VIDEO_TITLE.search(t["title"]) or (name == "youtube" and AUTO_VIDEO_TITLE.search(t["artist"])):
                excluded.append(f"{t['artist']} - {t['title']}")
                continue
            kept.append(t)
            today_items.append({**t, "source": name})
        reports[name] = {**{k: v for k, v in snap.items() if k != "tracks"}, "raw": len(snap.get("tracks", [])),
                         "kept": kept, "excluded": excluded}
        print(f"[build] 자동 수집 {name}: 상태 {snap.get('status')}, {len(snap.get('tracks', []))}곡 -> 영상 제목형 "
              f"{len(excluded)}곡 제외{' (오늘 스냅샷 재사용)' if snap.get('from_cache') else ''}"
              f"{' — ' + snap['error'] if snap.get('error') else ''}", flush=True)

    store = {"tracks": []}
    if os.path.exists(AUTO_STORE_PATH):
        try:
            with open(AUTO_STORE_PATH, encoding="utf-8") as f:
                store = json.load(f)
        except Exception as e:  # 누적 파일이 깨졌으면 덮어쓰지 않고 오늘 것만 씀
            print(f"[build] 경고: {AUTO_STORE_PATH} 읽기 실패({e}) — 이번 실행은 오늘 수집분만 사용, 파일은 그대로 둠")
            store = None
    entries = {f"{e['source']}|{normalize(e['artist'])}|{normalize(e['title'])}": e for e in (store or {}).get("tracks", [])}
    today = _today()
    for t in today_items:
        key = f"{t['source']}|{normalize(t['artist'])}|{normalize(t['title'])}"
        e = entries.get(key)
        if e is None:
            entries[key] = {"source": t["source"], "artist": t["artist"], "title": t["title"], "best_rank": t["rank"],
                            "image": t.get("image"), "first_seen": today, "last_seen": today}
        else:
            e["best_rank"] = min(e["best_rank"], t["rank"])
            e["last_seen"] = max(e["last_seen"], today)
            e["image"] = e.get("image") or t.get("image")
    merged = [entries[k] for k in sorted(entries)]
    if store is not None:
        with open(AUTO_STORE_PATH, "w", encoding="utf-8") as f:
            json.dump({"tracks": merged}, f, ensure_ascii=False, indent=1)
    return merged, reports


def _new_artist(official=None, ko=None, aliases=(), resolve=True, lastfm_name=None, latin_hint=None,
                seed_aliases=(), prio=PRIO_LIST, source="list"):
    """아티스트 명세. alias_prio: 별칭별 출처 우선순위(충돌 해소에 씀). seed_aliases: 영문이어도 색인할 별칭
    (수동 시드, 멜론 시드의 suggested_aliases_confident — 사람이 확인한 것만)."""
    alias_list = [a for a in aliases if a]
    return {"official": official, "ko": ko, "aliases": set(alias_list), "resolve": resolve,
            "lastfm_name": lastfm_name, "latin_hint": latin_hint, "seed_aliases": set(a for a in seed_aliases if a),
            "alias_prio": {a: prio for a in alias_list},
            "prio": {f: prio for f in ("official", "ko", "lastfm_name", "latin_hint")},
            "sources": {source}}


def indexable_aliases(spec: dict) -> list:
    """검색 색인에 넣을 별칭: 한글이 든 별칭(한글명, 발음 표기) + 사람이 확인한 영문 별칭(seed_aliases).
    자동으로 모인 영문 이름(정식 이름 "Treasure"/"Crush"/"Dean", 시험지의 "indigo", 멜론 표기의 영문 쪽 등)은
    색인하지 않음 — 영어 단어 검색("treasure" -> 브루노 마스 곡)을 가로채 버리기 때문. 영문 검색어는 파이프라인이 처리.
    "#안녕"/"그_냥"처럼 특수문자를 빼면 일반 단어가 되는 이름도 색인하지 않음."""
    pool = spec["aliases"] | {spec.get("ko") or ""}
    return sorted(x for x in pool if x and not UNINDEXABLE_NAME.search(x)
                  and (HANGUL.search(x) or x in spec["seed_aliases"]))


class SpecRegistry:
    """아티스트 명세 모음. 정식 이름/한글명/로마자 힌트 어느 것으로든 같은 아티스트를 찾아 합침."""

    def __init__(self):
        self.specs: list = []
        self.by_name: dict = {}

    def find(self, *names):
        for n in names:
            k = normalize(n or "")
            if k and k in self.by_name:
                return self.by_name[k]
        return None

    def add(self, spec: dict, match_names=None) -> dict:
        names = list(match_names or []) + [spec["official"], spec["ko"]]
        cur = self.find(*names)
        if cur is None:
            self.specs.append(spec)
            cur = spec
        else:
            for alias, p in spec["alias_prio"].items():
                cur["alias_prio"][alias] = max(p, cur["alias_prio"].get(alias, -1))
            cur["aliases"] |= spec["aliases"]
            cur["seed_aliases"] |= spec["seed_aliases"]
            cur["sources"] |= spec["sources"]
            for field in ("official", "ko", "lastfm_name", "latin_hint"):
                if spec.get(field) and (not cur.get(field) or spec["prio"][field] > cur["prio"][field]):
                    cur[field], cur["prio"][field] = spec[field], spec["prio"][field]
            cur["resolve"] = cur["resolve"] or spec["resolve"]  # 수동 목록 출처면 정식 이름 자동 조회 허용
        for n in (cur["official"], cur["ko"], cur["latin_hint"]):
            k = normalize(n or "")
            if k:
                self.by_name.setdefault(k, cur)
        return cur


def parse_melon_artist(raw: str, en_hint=None, ko_hint=None) -> dict:
    """멜론 아티스트 표기 -> {"ko", "en", "truncated"}. 여러 명("PATEKO (파테코),Kid Wine")이면 첫 번째(대표)만.
    "RESCENE (리센느)"(영문 밖/한글 안), "릴러말즈 (Leellamarz)"(한글 밖/영문 안)는 쌍으로 분리.
    "순순희(기태)"처럼 둘 다 한글이면 괄호는 멤버 표기라 버림. 잘린 괄호("소녀시대-효리수 (Girls' Generatio...")도 버림.
    "ヒグチアイ / Ai Higuchi"처럼 슬래시 표기면 영문 쪽을 이름으로."""
    primary = raw.split(",")[0].strip()
    truncated = "..." in primary
    if en_hint or ko_hint:
        return {"ko": ko_hint, "en": en_hint, "truncated": truncated}
    if " / " in primary and "(" not in primary:
        parts = [p.strip() for p in primary.split(" / ")]
        latin = [p for p in parts if re.fullmatch(r"[\x20-\x7e]+", p)]
        hangul = [p for p in parts if HANGUL.search(p)]
        return {"ko": hangul[0] if hangul else None, "en": latin[0] if latin else parts[0], "truncated": truncated}
    m = re.match(r"^(?P<out>[^()]+?)\s*\((?P<inner>[^()]*)\)?\s*$", primary)
    out, inner = (m["out"].strip(), m["inner"].strip()) if m else (primary.replace("...", "").strip(), "")
    if m and "..." in m["inner"]:
        inner = m["inner"].replace("...", "").split("/")[0].strip()
        inner = inner if HANGUL.search(inner) and "/" in m["inner"] else ""  # "토미오카 아이/冨岡 ..."만 살림
    out = out.replace("...", "").strip()
    if HANGUL.search(out) and inner and not HANGUL.search(inner):
        return {"ko": out, "en": inner, "truncated": truncated}
    if not HANGUL.search(out) and HANGUL.search(inner):
        return {"ko": inner, "en": out, "truncated": truncated}
    if HANGUL.search(out):
        return {"ko": out, "en": None, "truncated": truncated}
    latin_inner = inner if inner and re.fullmatch(r"[\x20-\x7e]+", inner) else None
    return {"ko": None, "en": latin_inner or out, "truncated": truncated}


def load_melon_seeds() -> tuple:
    """시드 4개 -> (트랙 목록, suggested_aliases_confident). 파일 순서/순위 순서 그대로(멱등)."""
    tracks, confident = [], {}
    for fname in SEED_FILES:
        path = os.path.join(HERE, fname)
        if not os.path.exists(path):
            print(f"[build] 시드 없음(건너뜀): {fname}")
            continue
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        for ko, als in ((data.get("_meta") or {}).get("suggested_aliases_confident") or {}).items():
            confident.setdefault(ko, []).extend(als)
        for t in data.get("tracks", []):
            tracks.append({**t, "chart": fname})
    return tracks, confident


def collect_artist_specs(seed: dict, melon_tracks: list, confident: dict, auto_entries: list = ()) -> tuple:
    """수동 목록/시험지/수동 시드/멜론 시드를 SpecRegistry로 합침. 반환: (명세 목록, 멜론 곡 -> 명세 매핑 목록)."""
    reg = SpecRegistry()
    for ko in main.KNOWN_KOREAN_ARTIST_NAMES + main.EXTRA_KOREAN_ARTIST_NAMES:
        reg.add(_new_artist(ko=ko, aliases=[ko]))
    for latin, ko in main.KOREAN_ARTIST_NAME_OVERRIDES.items():
        reg.add(_new_artist(ko=ko, aliases=[ko, latin], latin_hint=latin))

    with open(os.path.join(BACKEND, "search_eval", "queries.csv"), encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row["type"] != "artist":
                continue
            names = [n.strip() for n in row["expected"].split("|") if n.strip()]
            ko_names = [n for n in names if HANGUL.search(n)]
            latin_names = [n for n in names if not HANGUL.search(n) and re.fullmatch(r"[\x20-\x7e]+", n)]
            # 정식/한글 쌍이 확실한 행만("인디고|indigo"는 수동 시드, J-POP 발음 행은 수동 시드가 정의)
            if not ko_names or not latin_names or reg.find(*latin_names) is None and reg.find(*ko_names) is None:
                continue
            reg.add(_new_artist(official=latin_names[0], ko=ko_names[0], aliases=names, resolve=False,
                                prio=PRIO_QUERIES, source="queries"))

    # 수동 시드(최우선). 별칭이 다른 명세("여자아이들")와 겹치면 그 명세에도 같은 값을 덮어씀(자동 조회 오류 교정)
    for a in seed.get("artists", []):
        def seed_spec():
            return _new_artist(official=a["official"], ko=a.get("ko"), aliases=a.get("aliases", []) + [a["official"]],
                               resolve=a.get("resolve", True), lastfm_name=a.get("lastfm_name"),
                               seed_aliases=a.get("aliases", []), prio=PRIO_MANUAL, source="manual")
        reg.add(seed_spec())
        for alias in a.get("aliases", []):
            other = reg.find(alias)
            if other is not None and other is not reg.find(a["official"], a.get("ko")):
                reg.add(seed_spec(), match_names=[alias])

    # 멜론 시드: "영문 (한글)"/영문만 표기를 먼저, "한글 (영문)"을 나중에 — 괄호 안 영문이 이미 다른 한글명을 가진
    # 아티스트면("진영 (GOT7)" -> GOT7은 갓세븐) 영문 이름이 아니라 소속 표기로 보고 버림
    parsed = [(t, parse_melon_artist(t["artist"], t.get("artist_en"), t.get("artist_ko"))) for t in melon_tracks]
    order = sorted(range(len(parsed)), key=lambda i: 1 if (parsed[i][1]["ko"] and parsed[i][1]["en"]
                                                         and HANGUL.search(parsed[i][0]["artist"].split("(")[0])) else 0)
    track_specs = [None] * len(parsed)
    for i in order:
        t, p = parsed[i]
        ko, en = p["ko"], p["en"]
        if ko and en:
            by_en = reg.find(en)
            known_names = {normalize(x) for x in (by_en or {}).get("aliases", set())}
            # 한글 쪽이 그 아티스트의 이미 알려진 별칭이면 같은 사람("BIG Naughty (서동현)" — 수동 시드가 서동현을 별칭으로 둠)
            if by_en is not None and by_en.get("ko") and normalize(by_en["ko"]) != normalize(ko) \
                    and normalize(ko) not in known_names:
                print(f"[build] 멜론 표기 '{t['artist']}': 괄호 '{en}'는 소속 표기로 보고 버림(그 이름은 '{by_en['ko']}')")
                en = None
        if not ko and not en:
            continue
        aliases = [x for x in (ko, en) if x]
        track_specs[i] = reg.add(_new_artist(official=en, ko=ko, aliases=aliases, resolve=False,
                                             prio=PRIO_MELON, source="melon"))
    for ko, als in confident.items():
        indexable = [x for x in als if normalize(x) not in CONFIDENT_ALIAS_STOPWORDS]
        reg.add(_new_artist(ko=ko, aliases=[ko] + als, resolve=False, seed_aliases=indexable, prio=PRIO_MELON,
                            source="melon"))
    # 자동 수집(애플 KR 스토어 표기): 한글 이름이 있고 아직 없는 아티스트만 새로 만듦(PRIO_AUTO — 기존 값 덮어쓰기 불가).
    # - 정식/한글 이름뿐 아니라 기존 별칭까지 확인("백 넘버"는 back number의 수동 별칭 — 별개 아티스트로 만들면 안 됨)
    # - 한 글자 이름("팀")은 일반 단어 검색을 가로채므로 만들지 않음
    # - 영문만 있는 새 아티스트는 색인할 별칭이 없어 만들지 않음(Last.fm/유튜브 항목은 기존 아티스트에만 붙음)
    known_aliases = {normalize(x) for sp in reg.specs for x in sp["aliases"]}
    for e in auto_entries:
        name = _primary_artist(e["artist"])
        key = normalize(name)
        if e["source"] == "apple" and reg.find(name, e["artist"]) is None and key not in known_aliases \
                and HANGUL.search(name) and len(key) >= 2 and not UNINDEXABLE_NAME.search(name):
            reg.add(_new_artist(ko=name, aliases=[name], resolve=False, prio=PRIO_AUTO, source="auto"))
            known_aliases.add(key)
    melon_pairs = [(t, sp) for (t, _), sp in zip(parsed, track_specs) if sp is not None]
    return reg.specs, melon_pairs


def resolve_official(spec: dict) -> dict:
    """정식 이름/아티스트 사진 확정. 이미 정해진(resolve=False 또는 시험지) 이름은 그대로 둠."""
    image = None
    if spec["resolve"] and not spec["official"] and spec["ko"] and HANGUL.search(spec["ko"]):
        found = _daily("official", normalize(spec["ko"]),
                       lambda: main._resolve_official_korean_artist(spec["ko"], spec.get("latin_hint")))
        if found:
            spec["official"] = found["artist"]["name"]
            image = found["artist"].get("image")
    if not spec["official"]:
        spec["official"] = spec["ko"]
    spec["aliases"].add(spec["official"])
    if image:
        spec["image"] = image
    elif spec["sources"] <= {"melon", "auto"}:
        spec["image"] = _daily("artist-image-checked", f"{normalize(spec['official'])}:{normalize(spec.get('ko') or '')}",
                               lambda: checked_artist_image(spec))
    else:
        spec["image"] = _daily("artist-image", normalize(spec["official"]),
                               lambda: main.resolve_artist_image(spec["official"]))
    return spec


def checked_artist_image(spec: dict):
    """멜론 시드에서만 나온 아티스트("한로로", "tuki.")의 사진. main.resolve_artist_image는 Deezer 1위를 이름 확인 없이
    쓰는데, 처음 보는 이름은 동명이인/엉뚱한 1위가 나올 위험이 커서 이름이 정확히 같은 Deezer 항목만 채택하고,
    없으면 Last.fm 인기곡 1위 앨범 커버(main.fetch_top_track_cover)로 대신함."""
    # 다른 이미지 조회(resolve_artist_image 등)처럼 Redis에 캐싱 — 안 하면 Deezer 응답이 흔들릴 때마다 결과가 달라져서
    # 생성기를 연달아 돌려도 catalog.json이 바뀜(멱등성 깨짐). Deezer 호출 자체가 실패하면 캐싱하지 않음.
    cache_key = f"artist-image-checked:v1:{normalize(spec['official'])}:{normalize(spec.get('ko') or '')}"
    cached = main.get_cached(cache_key)
    if cached is not None:
        return cached.get("url")
    names = {normalize(x) for x in (spec["official"], spec.get("ko")) if x}
    failed = False
    image = None
    for name in filter(None, (spec["official"], spec.get("ko"))):
        items = main._deezer_artist_search(name, 5)
        if items is None:
            failed = True
            continue
        for item in items:
            if normalize(item.get("name") or "") in names and main._deezer_picture(item):
                image = main._deezer_picture(item)
                break
        if image:
            break
    if not image:
        image = main.fetch_top_track_cover(spec["official"])
    if image or not failed:
        main.set_cached(cache_key, {"url": image}, ttl=main.TRACK_IMAGE_CACHE_TTL_SECONDS if image
                        else main.TRACK_IMAGE_NEGATIVE_CACHE_TTL_SECONDS)
    return image


TOP_TRACKS_CACHE_TTL_SECONDS = 60 * 60 * 24 * 7


def _top_raw_cached(name: str) -> list:
    """Last.fm artist.getTopTracks 원본(30곡)을 Redis에 7일 캐싱. main._fetch_artist_top_raw는 타임아웃/오류 때 조용히
    빈 목록을 돌려줘서, 그대로 쓰면 네트워크가 흔들린 회차만 대표곡이 빠져 생성 결과가 달라짐(멱등성 깨짐) — 그래서
    여기선 lastfm_get을 직접 불러 성공한 응답만 캐싱하고, 실패는 캐싱하지 않음."""
    cache_key = f"build-top-tracks:v1:{name.lower().strip()}"
    cached = main.get_cached(cache_key)
    if cached is not None:
        return cached.get("tracks") or []
    try:
        data = main.lastfm_get({"method": "artist.getTopTracks", "artist": name, "limit": 30})
    except main.HTTPException as e:
        if e.status_code == 400:  # Last.fm에 없는 아티스트(확정적인 결과) — 빈 목록도 캐싱
            main.set_cached(cache_key, {"tracks": []}, ttl=TOP_TRACKS_CACHE_TTL_SECONDS)
        return []
    tracks = data.get("toptracks", {}).get("track", [])
    main.set_cached(cache_key, {"tracks": tracks}, ttl=TOP_TRACKS_CACHE_TTL_SECONDS)
    return tracks


def _top_tracks_for(name: str) -> list:
    raw = _top_raw_cached(name)
    items = [{"name": t["name"], "listeners": t.get("listeners"), "url": t.get("url"), "_raw": t} for t in raw]
    items = [t for t in main._clean_top_tracks(items) if not EXTRA_VIDEO_TITLE.search(t["name"])]
    # 표기만 다른 같은 곡("Galaxy 우주를 줄게"/"Galaxy", "NAN CHUN 난춘"/"Nan Chun") — 정규화 제목이 서로 포함되면 같은 곡
    kept, keys = [], []
    for t in items:
        k = normalize(t["name"])
        if any(min(len(k), len(o)) >= 4 and (k in o or o in k) for o in keys):
            continue
        kept.append(t)
        keys.append(k)
    return kept[:TRACKS_PER_ARTIST]


def fetch_tracks(spec: dict) -> list:
    """대표곡: Last.fm에서 정식/한글 이름 중 청취자 합이 큰 쪽의 인기곡 상위 TRACKS_PER_ARTIST곡."""
    names = [spec["lastfm_name"]] if spec.get("lastfm_name") else list(dict.fromkeys(filter(None, [spec["official"], spec["ko"]])))
    best, best_name, best_sum = [], None, -1
    for name in names:
        tracks = _top_tracks_for(name)
        total = sum(int(t.get("listeners") or 0) for t in tracks)
        ko_ok = (HANGUL.search(name) and len(tracks) >= KO_LIST_MIN_TRACKS and total >= KO_LIST_MIN_LISTENERS)
        if ko_ok:  # 한글명 등록 쪽이 충분하면 청취자 합과 상관없이 우선(한글 곡 제목을 살리기 위해)
            best, best_name, best_sum = tracks, name, float("inf")
        elif total > best_sum:
            best, best_name, best_sum = tracks, name, total
    # (2026-11-18) 대표곡을 실제로 가져온 Last.fm 이름을 "조회용 이름"으로 남김 — 아티스트 페이지/추천도 같은 이름으로
    # 조회해야 같은 곡이 나옴("아이유"로 조회하면 한글 제목, "IU"로 조회하면 영문 제목 / "라이즈"로 조회하면 방송 클립이
    # 섞이고 "RIIZE"로 조회하면 깨끗함 — 2026-11-18 실측)
    spec["lookup_name"] = best_name if best else None
    out = []
    for t in best:
        ko_title = None
        if not HANGUL.search(t["name"]):
            cached = main.get_cached(main._korean_title_cache_key(best_name, t["name"]))  # 캐시만 — Claude 호출 없음
            ko_title = (cached or {}).get("title")
        out.append({
            "title": t["name"],
            "ko_title": ko_title,
            "listeners": t.get("listeners"),
            "url": t.get("url") or "",
            "image": track_image(best_name, t["name"], t["_raw"].get("image", [])),
            "aliases": [],
        })
    return out


def _title_key(title: str) -> str:
    """곡 중복 판정용 제목 키: 괄호 부가정보를 뺀 정규화 제목("고백(Go Back) (Feat.정인)" -> "고백")."""
    return normalize(main._strip_paren(title)) or normalize(title)


def merge_melon_tracks(artists: list, tracks_by_artist: dict, melon_pairs: list) -> int:
    """멜론 시드 곡을 각 아티스트 대표곡 앞쪽에 합침. 중복 기준은 (정규화 제목, 아티스트) — 차트 4개에 같은 곡이 여러 번
    나와도 한 곡, Last.fm 대표곡과 같으면 그 항목을 앞으로 옮김. 잘린 곡(truncated)은 곡을 만들지 않음(아티스트만 등록)."""
    added = 0
    front: dict = {}
    for t, spec in melon_pairs:
        if t.get("truncated") or "..." in t["title"]:
            continue
        a = spec["_final"]
        tl = tracks_by_artist[a["id"]]
        key = _title_key(t["title"])
        existing = next((x for x in tl if _title_key(x["title"]) == key), None)
        if existing is None:
            existing = {"title": t["title"], "ko_title": None, "listeners": None, "url": "",
                        "image": track_image(a["official"], t["title"], []), "aliases": []}
            tl.append(existing)
            added += 1
        existing.setdefault("seed_titles", [])
        if t["title"] not in existing["seed_titles"]:
            existing["seed_titles"].append(t["title"])
        front.setdefault(a["id"], [])
        if existing not in front[a["id"]]:
            front[a["id"]].append(existing)
    for aid, seeded in front.items():  # 멜론 차트 곡을 Last.fm 대표곡보다 앞에(시드 등장 순서 유지)
        rest = [x for x in tracks_by_artist[aid] if x not in seeded]
        tracks_by_artist[aid][:] = seeded + rest
    return added


def _auto_title_keys(title: str) -> set:
    """자동 수집 곡 매칭 키: 괄호 뗀 제목 + "한글 제목 (영문 제목)" 형태면 영문 제목도("백화요란 (Inside Out)" = "Inside Out").
    feat/prod/remix 같은 괄호는 곡 이름이 아니라서 키로 안 씀(서로 다른 곡이 같은 피처링으로 합쳐지는 것 방지)."""
    keys = {_title_key(title)}
    m = re.match(r"^\s*(.+?)\s*\(([^()]+)\)", title or "")
    if m and HANGUL.search(m[1]) and not HANGUL.search(m[2]) and not re.match(
            r"(?i)\s*(feat|prod|with|remix|ver|inst|live|sped|acoustic|english|japanese|korean|from|op|ed)\b", m[2]):
        keys.add(normalize(m[2]))
    return {k for k in keys if k}


def merge_auto_tracks(artists: list, tracks_by_artist: dict, auto_entries: list, index: dict) -> dict:
    """자동 수집 곡을 아티스트별로 묶어(소스 간 같은 곡 = 같은 아티스트 + 제목 키 겹침) 대표곡에 합침.
    - 여러 소스에 겹친 곡일수록 앞에(소스 수 내림차순 > 최고 순위 > 제목), 멜론/수동 곡 다음 자리
    - 유튜브에만 나온 곡은 추가하지 않음(영문 현지화 제목이라 기존 한글 제목 곡의 번역 중복이 생김) — 겹침 신호로만 씀
    - 기존 곡과 같으면 새로 만들지 않고 출처만 표시(이미지가 없으면 애플 아트워크로 채움)"""
    groups: dict = {}
    stats = {"matched": 0, "unmatched": 0, "unmatched_examples": [], "new_tracks": 0, "youtube_only": 0,
             "overlap_2plus": 0, "overlap_3": 0, "overlap_examples": [], "new_examples": []}
    for e in auto_entries:
        a = index.get(normalize(_primary_artist(e["artist"]))) or index.get(normalize(e["artist"]))
        if a is None:
            stats["unmatched"] += 1
            if len(stats["unmatched_examples"]) < 8:
                stats["unmatched_examples"].append(f"{e['source']}: {e['artist']} - {e['title']}")
            continue
        stats["matched"] += 1
        keys = _auto_title_keys(e["title"])
        g = next((g for g in groups.get(a["id"], []) if g["keys"] & keys), None)
        if g is None:
            g = {"keys": set(), "entries": []}
            groups.setdefault(a["id"], []).append(g)
        g["keys"] |= keys
        g["entries"].append(e)

    by_id = {a["id"]: a for a in artists}
    for aid in sorted(groups):
        a, tl = by_id[aid], tracks_by_artist[aid]
        for g in groups[aid]:
            sources = sorted({e["source"] for e in g["entries"]})
            if sources == ["youtube"]:
                stats["youtube_only"] += 1
                continue
            best = min(e["best_rank"] for e in g["entries"])
            apple = next((e for e in g["entries"] if e["source"] == "apple"), None)
            base = apple or next(e for e in g["entries"] if e["source"] != "youtube")
            if len(sources) >= 2:
                stats["overlap_2plus"] += 1
                stats["overlap_3"] += len(sources) == 3
                if len(stats["overlap_examples"]) < 8:
                    stats["overlap_examples"].append(f"{a['official']} - {base['title']} ({'+'.join(sources)})")
            existing = next((t for t in tl if (_auto_title_keys(t["title"]) | _auto_title_keys(t.get("ko_title") or ""))
                             & g["keys"]), None)
            if existing is None:
                existing = {"title": base["title"], "ko_title": None, "listeners": None, "url": "",
                            "image": (apple or {}).get("image") or track_image(a["official"], base["title"], []),
                            "aliases": [], "auto_new": True}
                tl.append(existing)
                stats["new_tracks"] += 1
                if len(stats["new_examples"]) < 10:
                    stats["new_examples"].append(f"{a['official']} - {base['title']}")
            existing["auto_sources"] = sorted(set(existing.get("auto_sources", [])) | set(sources))
            existing["auto_rank"] = min(existing.get("auto_rank", best), best)
            existing["image"] = existing.get("image") or (apple or {}).get("image")
        seeded = [t for t in tl if t.get("seed_titles")]
        autos = sorted([t for t in tl if not t.get("seed_titles") and t.get("auto_sources")],
                       key=lambda t: (-len(t["auto_sources"]), t["auto_rank"], t["title"]))
        rest = [t for t in tl if t not in seeded and t not in autos]
        tl[:] = seeded + autos + rest
    return stats


def translation_dup_candidates(artists: list, tracks_by_artist: dict) -> list:
    """번역 제목 중복 "의심" 목록(자동 판정 아님, 건드리지 않고 보고만). 아티스트 단위로:
    멜론/자동 수집으로 들어왔는데 Last.fm 대표곡과 매칭되지 못한 한글 제목 곡(청취자 수 없음)이 있고, 같은 아티스트의
    Last.fm 대표곡에 근거 없는 3단어 이상 영문 문장형 제목이 있으면 후보("영원은 그렇듯" ↔ "Forever Has Always Been").
    블랙핑크 "마지막처럼"/"As If It's Your Last"처럼 둘 다 Last.fm에서 온 경우는 이 기준으로 못 잡음."""
    out = []
    for a in sorted(artists, key=lambda x: x["id"]):
        tl = tracks_by_artist[a["id"]]
        hangul_unmatched = [t["title"] for t in tl if HANGUL.search(t["title"]) and t.get("listeners") in (None, "")
                            and (t.get("seed_titles") or t.get("auto_new"))]
        latin_sentences = [t["title"] for t in tl if not HANGUL.search(t["title"]) and not t.get("seed_titles")
                           and not t.get("auto_sources") and not t.get("aliases")
                           and len(re.findall(r"[A-Za-z'′]+", main._strip_paren(t["title"]))) >= 3]
        if hangul_unmatched and latin_sentences:
            out.append(f"{a.get('ko') or a['official']}: {', '.join(hangul_unmatched[:3])} ↔ {', '.join(latin_sentences[:3])}")
    return out


def write_source_check(reports: dict, stats: dict, totals: dict, dup_candidates: list) -> None:
    """소스별 상태/결과를 사람이 읽는 표로 저장(catalog/source_check.md). 날짜별 스냅샷 값이라 같은 날엔 같은 내용."""
    lines = [f"# 자동 수집 소스 점검 ({_today()})", "",
             "build_catalog.py 실행 시 자동 생성되는 파일. 상태/응답 시간은 그날 처음 호출했을 때 값(이후엔 스냅샷 재사용).", "",
             "| 소스 | HTTP 상태 | 받은 곡 | 영상 제목형 제외 | 남은 곡 | 한글 제목 | 한글 아티스트 | 응답 시간 | 비고 |",
             "|---|---|---|---|---|---|---|---|---|"]
    for name, r in reports.items():
        kept = r["kept"]
        h_title = sum(1 for t in kept if HANGUL.search(t["title"]))
        h_artist = sum(1 for t in kept if HANGUL.search(t["artist"]))
        note = r.get("error") or ""
        if name == "apple":
            note = (note + f" 시도 {r.get('attempts', 1)}회").strip()
        if name == "lastfm":
            note = (note + f' country="{LASTFM_KR_COUNTRY}" ("south korea"는 400: country param invalid)').strip()
        if name == "youtube":
            note = (note + " 음악 카테고리 1회(쿼터 1유닛), 겹침 신호로만 사용").strip()
        lines.append(f"| {name} | {r.get('status')} | {r['raw']} | {len(r['excluded'])} | {len(kept)} | {h_title} | {h_artist} | "
                     f"{r.get('elapsed')}s | {note} |")
    lines += ["", "## 소스별 샘플 5개", ""]
    for name, r in reports.items():
        lines.append(f"- **{name}**: " + (" / ".join(f"{t['artist']} - {t['title']}" for t in r["kept"][:5]) or "(없음)"))
    lines += ["", "## 제외된 영상 제목형 예시", ""]
    excluded = [f"{n}: {x}" for n, r in reports.items() for x in r["excluded"]]
    lines += [f"- {x}" for x in excluded[:10]] or ["- (없음)"]
    lines += ["", "## 병합 결과", "",
              f"- 누적 자동 수집 항목 {totals['auto_entries']}개 중 기존/새 아티스트에 매칭 {stats['matched']}개, 매칭 안 됨 {stats['unmatched']}개",
              f"- 새로 추가된 곡 {stats['new_tracks']}개, 새로 만든 아티스트 {totals['new_artists']}명, 유튜브에만 나와 제외한 곡 {stats['youtube_only']}개",
              f"- 2개 이상 소스에 겹친 곡 {stats['overlap_2plus']}개(3개 모두 {stats['overlap_3']}개)",
              f"- 최종 별칭표: 아티스트 {totals['artists']}명, 곡 {totals['tracks']}곡, 모호 별칭 {totals['ambiguous']}개",
              f"- 이번 실행 외부 호출: 소스 HTTP {CALL_STATS['http_calls']}회(Last.fm {CALL_STATS['lastfm_calls']}회), "
              f"유튜브 쿼터 {CALL_STATS['youtube_units']}유닛", "",
              "겹친 곡 예시: " + ("; ".join(stats["overlap_examples"]) or "(없음)"), "",
              "매칭 안 된 항목 예시(영문만 있는 새 아티스트 등): " + ("; ".join(stats["unmatched_examples"]) or "(없음)"), "",
              f"## 번역 제목 중복 의심 아티스트 {len(dup_candidates)}명 (자동 판정 아님 — 건드리지 않음)", "",
              "형식: 아티스트: 매칭 안 된 한글 제목 ↔ 근거 없는 영문 문장형 제목(각 최대 3개)", ""]
    lines += [f"- {x}" for x in dup_candidates[:40]] or ["- (없음)"]
    with open(SOURCE_CHECK_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def dedupe_artist_tracks(tracks: list) -> list:
    """한 아티스트 안의 같은 곡을 하나로: 괄호 부가정보를 뗀 정규화 제목("그 날"/"그 날 (Feat. 헤이즐)"), 한글 제목
    ("Haru Haru"의 한글 제목 "하루 하루" = "하루하루"), "한글 (영문)" 표기의 영문 쪽이 같으면 같은 곡. 앞에 온 것(수동 > 멜론 > Last.fm 순)을 남기고
    뒤의 별칭/멜론 제목/이미지/청취자 수를 합침."""
    kept, key_owner = [], {}
    for t in tracks:
        # "한글 제목 (영문 제목)"의 괄호 안 영문이 다른 곡 제목과 정확히 같으면 같은 곡으로 판정 가능("띠로리 (DDI RO RI)" =
        # "DDI RO RI", "사랑을 했다 (LOVE SCENARIO)" = "LOVE SCENARIO"). 그런 근거 없는 번역 제목은 합치지 않음(보고만).
        keys = _auto_title_keys(t["title"]) | _auto_title_keys(t.get("ko_title") or "")
        owner = next((key_owner[k] for k in keys if k in key_owner), None)
        if owner is None:
            kept.append(t)
            for k in keys:
                key_owner[k] = t
            continue
        owner["aliases"] = list(dict.fromkeys(owner.get("aliases", []) + t.get("aliases", [])))
        owner["seed_titles"] = list(dict.fromkeys(owner.get("seed_titles", []) + t.get("seed_titles", [])))
        owner["image"] = owner.get("image") or t.get("image")
        owner["listeners"] = owner.get("listeners") or t.get("listeners")
        owner["ko_title"] = owner.get("ko_title") or t.get("ko_title")
        if t.get("auto_sources"):
            owner["auto_sources"] = sorted(set(owner.get("auto_sources", [])) | set(t["auto_sources"]))
        for k in keys:
            key_owner.setdefault(k, owner)
    return kept


def resolve_alias_claims(artists: list, tracks_by_artist: dict) -> tuple:
    """별칭 후보를 모아 충돌을 정리. 반환: (아티스트별 최종 별칭, 곡별 최종 별칭, 모호 목록).
    - 수동 시드 별칭(우선순위 3)이 걸린 별칭은 수동 항목만 남김("인디고" = 아티스트 인디고 + 저스디스 IndiGO는 의도된 것)
    - 그 외에, 아티스트 별칭과 그 아티스트 본인 곡 별칭이 겹치면 아티스트 쪽만 남김(아티스트 결과에 그 곡도 나옴)
    - 그래도 서로 다른 항목에 걸리면("고백" = 멜로망스/델리스파이스/뜨거운 감자) 별칭표로 단정하지 않고 모두에서 빼고
      ambiguous에 기록 -> 그 검색어는 기존 파이프라인이 처리"""
    claims: dict = {}  # 정규화 별칭 -> [(종류, id, 우선순위, 원래 별칭, 아티스트 id)]

    def claim(alias, kind, item_id, prio, artist_id):
        key = normalize(alias)
        # 한 글자 곡 제목 별칭("목", "화", "숲", "춤")은 일반 단어 검색을 가로채므로 수동 시드에 직접 적은 경우만 색인.
        # 아티스트 이름("딘", "숀")은 일반 단어가 아니라서 그대로 둠(자동 수집으로 새로 만드는 아티스트는 2글자 이상만).
        if kind == "track" and len(key) < 2 and prio != PRIO_MANUAL:
            return
        if key and not UNINDEXABLE_NAME.search(alias):
            claims.setdefault(key, []).append((kind, item_id, prio, alias, artist_id))

    for a in artists:
        for alias in indexable_aliases(a):
            claim(alias, "artist", a["id"], a["alias_prio"].get(alias, PRIO_LIST), a["id"])
        ko = a.get("ko") if a.get("ko") and HANGUL.search(a["ko"]) and not UNINDEXABLE_NAME.search(a["ko"]) else None
        for t in tracks_by_artist[a["id"]]:
            tid = f"{a['id']}:{normalize(t['title'])}"
            for alias in t["aliases"]:  # 수동 시드 곡 별칭
                claim(alias, "track", tid, PRIO_MANUAL, a["id"])
            if t.get("auto_sources"):  # 자동 수집으로 확인된 곡의 한글 제목(영문 단독 제목은 색인 안 함)
                for variant in dict.fromkeys([t["title"], main._strip_paren(t["title"])]):
                    if HANGUL.search(variant):
                        claim(variant, "track", tid, PRIO_AUTO, a["id"])
            for title in t.get("seed_titles", []):  # 멜론 시드의 한글 제목(영문 제목은 색인 안 함)
                for variant in dict.fromkeys([title, main._strip_paren(title)]):
                    if HANGUL.search(variant):
                        claim(variant, "track", tid, PRIO_MELON, a["id"])
            if ko and not any(x in t["title"] for x in ("...",)):  # "한글 아티스트명 + 제목" 조합(창모 아름다워)
                for title in dict.fromkeys(filter(None, [t["title"], main._strip_paren(t["title"]), t.get("ko_title")])):
                    claim(f"{ko} {title}", "track", tid, PRIO_AUTO if t.get("auto_new") else PRIO_MELON, a["id"])

    artist_aliases, track_aliases, ambiguous = {}, {}, []
    for key in sorted(claims):
        cs = claims[key]
        if any(c[2] > PRIO_AUTO for c in cs):  # 자동 수집은 기존 별칭을 바꾸거나 모호하게 만들지 못함
            cs = [c for c in cs if c[2] > PRIO_AUTO]
        if max(c[2] for c in cs) == PRIO_MANUAL:
            cs = [c for c in cs if c[2] == PRIO_MANUAL]
        else:
            artist_ids = {c[1] for c in cs if c[0] == "artist"}
            cs = [c for c in cs if c[0] == "artist" or c[4] not in artist_ids]
            entities = sorted({(c[0], c[1]) for c in cs})
            if len(entities) > 1:
                ambiguous.append({"alias": cs[0][3], "candidates": [f"{k}:{i}" for k, i in entities]})
                continue
        for kind, item_id, _, alias, _ in cs:
            target = artist_aliases if kind == "artist" else track_aliases
            bucket = target.setdefault(item_id, [])
            if all(normalize(x) != key for x in bucket):
                bucket.append(alias)
    return artist_aliases, track_aliases, ambiguous


def build() -> dict:
    with open(os.path.join(HERE, "manual_seed.json"), encoding="utf-8") as f:
        seed = json.load(f)
    melon_tracks, confident = load_melon_seeds()
    auto_entries, auto_reports = collect_auto_sources()
    specs, melon_pairs = collect_artist_specs(seed, melon_tracks, confident, auto_entries)
    new_auto_artists = sum(1 for sp in specs if sp["sources"] == {"auto"})
    print(f"[build] 아티스트 명세 {len(specs)}개(멜론 시드 곡 {len(melon_tracks)}개) — 정식 이름/사진 확인 중...", flush=True)
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        specs = list(ex.map(resolve_official, specs))

    # 정식 이름이 같은 항목은 한 아티스트("아이들"/"(여자)아이들" -> 같은 그룹)
    by_official: dict = {}
    for s in specs:
        key = normalize(s["official"])
        if key in by_official:
            keep = by_official[key]
            for alias, p in s["alias_prio"].items():
                keep["alias_prio"][alias] = max(p, keep["alias_prio"].get(alias, -1))
            keep["aliases"] |= s["aliases"]
            keep["seed_aliases"] |= s["seed_aliases"]
            keep["sources"] |= s["sources"]
            keep["image"] = keep["image"] or s["image"]
            if not keep.get("ko") and s.get("ko"):
                keep["ko"] = s["ko"]
            s["_final"] = keep
        else:
            by_official[key] = s
            s["_final"] = s
    artists = list(by_official.values())
    for a in artists:
        a["id"] = normalize(a["official"]) or normalize(a["ko"] or "")
    if len({a["id"] for a in artists}) != len(artists):
        raise SystemExit("[build] 아티스트 id 중복 — manual_seed.json을 확인하세요")
    print(f"[build] 아티스트 {len(artists)}명 — 대표곡/이미지 조회 중...", flush=True)
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        track_lists = list(ex.map(fetch_tracks, artists))
    tracks_by_artist = {a["id"]: tl for a, tl in zip(artists, track_lists)}
    added = merge_melon_tracks(artists, tracks_by_artist, melon_pairs)

    alias_to_artist = {}
    for a in artists:
        for alias in sorted(a["aliases"] | {a["official"], a.get("ko") or ""}):
            alias_to_artist.setdefault(normalize(alias), a)
    auto_stats = merge_auto_tracks(artists, tracks_by_artist, auto_entries, alias_to_artist)
    for st in seed.get("tracks", []):  # 수동 시드 곡(최우선) — 그 아티스트 대표곡 맨 앞
        a = alias_to_artist.get(normalize(st["artist"]))
        if a is None:
            print(f"[build] 경고: 시드 곡 '{st['title']}'의 아티스트 '{st['artist']}'를 못 찾음 — 건너뜀")
            continue
        tl = tracks_by_artist[a["id"]]
        existing = next((t for t in tl if _title_key(t["title"]) == _title_key(st["title"])), None)
        if existing is None:
            existing = {"title": st["title"], "ko_title": st.get("ko_title"), "listeners": None, "url": "",
                        "image": st.get("image") or track_image(a["official"], st["title"], []),
                        "aliases": []}
        else:
            tl.remove(existing)
        tl.insert(0, existing)
        existing["aliases"] = list(dict.fromkeys(existing["aliases"] + st.get("aliases", [])))
        if st.get("ko_title"):
            existing["ko_title"] = st["ko_title"]

    for a in artists:
        tracks_by_artist[a["id"]] = dedupe_artist_tracks(tracks_by_artist[a["id"]])
    artist_aliases, track_aliases, ambiguous = resolve_alias_claims(artists, tracks_by_artist)
    out_tracks = []
    for a in sorted(artists, key=lambda x: x["id"]):
        seen_ids = set()
        for t in tracks_by_artist[a["id"]]:
            tid = f"{a['id']}:{normalize(t['title'])}"
            if tid in seen_ids:
                continue
            seen_ids.add(tid)
            out_tracks.append({"id": tid, "artist_id": a["id"], "title": t["title"], "ko_title": t.get("ko_title"),
                               "listeners": t.get("listeners"), "url": t.get("url") or "", "image": t.get("image"),
                               "aliases": track_aliases.get(tid, [])})
    out_artists = [{"id": a["id"], "official": a["official"], "ko": a.get("ko"),
                    "lookup": a.get("lookup_name") or a["official"],
                    "aliases": artist_aliases.get(a["id"], []), "image": a.get("image")}
                   for a in sorted(artists, key=lambda x: x["id"])]
    print(f"[build] 멜론 시드에서 새로 추가된 곡 {added}개, 자동 수집에서 새로 추가된 곡 {auto_stats['new_tracks']}개"
          f"(새 아티스트 {new_auto_artists}명, 겹친 곡 {auto_stats['overlap_2plus']}개), 모호 별칭 {len(ambiguous)}개")
    dup_candidates = translation_dup_candidates(artists, tracks_by_artist)
    write_source_check(auto_reports, auto_stats, {
        "auto_entries": len(auto_entries), "new_artists": new_auto_artists, "artists": len(out_artists),
        "tracks": len(out_tracks), "ambiguous": len(ambiguous)}, dup_candidates)
    print(f"[build] 외부 호출(자동 수집 소스): HTTP {CALL_STATS['http_calls']}회, 유튜브 쿼터 {CALL_STATS['youtube_units']}유닛 "
          f"— 소스 점검 결과 {SOURCE_CHECK_PATH}")
    return {"version": 2, "artists": out_artists, "tracks": out_tracks, "ambiguous": ambiguous}


if __name__ == "__main__":
    started = time.time()
    catalog = build()
    path = os.path.join(HERE, "catalog.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=1)
    no_img = sum(1 for t in catalog["tracks"] if not t["image"])
    print(f"[build] 완료 {time.time() - started:.0f}초: 아티스트 {len(catalog['artists'])}명, 곡 {len(catalog['tracks'])}곡 "
          f"(이미지 없는 곡 {no_img}개) -> {path}")
