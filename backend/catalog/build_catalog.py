"""별칭표(catalog.json) 생성기 — 서버가 아니라 사람이 필요할 때 한 번 돌리는 스크립트.

사용법(backend 폴더의 venv로):
  backend/venv/bin/python backend/catalog/build_catalog.py

입력:
  1) main.py의 수동 아티스트 목록: KNOWN_KOREAN_ARTIST_NAMES, EXTRA_KOREAN_ARTIST_NAMES, KOREAN_ARTIST_NAME_OVERRIDES
  2) search_eval/queries.csv의 아티스트 정답("RIIZE|라이즈" -> 정식 RIIZE, 한글 라이즈)
  3) catalog/manual_seed.json: 직접 쓴 아티스트/곡 별칭(메테오 -> 창모 METEOR 등) — 항상 최우선, 덮어쓰지 않음
  4) catalog/seed_melon_*.json(멜론 차트 화면을 사람이 옮겨 적은 시드 4개): 아티스트 + 곡 + 한글 제목 별칭
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
SEED_FILES = ["seed_melon_top100.json", "seed_melon_rap_daily.json", "seed_melon_jpop_daily.json", "seed_melon_indie_daily.json"]
# 출처 우선순위: 높은 쪽 값만 덮어쓸 수 있음 — 수동 시드는 어떤 경우에도 덮어써지지 않음
PRIO_LIST, PRIO_MELON, PRIO_QUERIES, PRIO_MANUAL = 0, 1, 2, 3
# "#안녕", "그_냥", "조선힙합_official": 특수문자를 빼고 정규화하면 일반 단어("안녕", "그냥")가 돼서 검색을 가로챔 — 색인 안 함
UNINDEXABLE_NAME = re.compile(r"[#_]")


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


def collect_artist_specs(seed: dict, melon_tracks: list, confident: dict) -> tuple:
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
        reg.add(_new_artist(ko=ko, aliases=[ko] + als, resolve=False, seed_aliases=als, prio=PRIO_MELON,
                            source="melon"))
    melon_pairs = [(t, sp) for (t, _), sp in zip(parsed, track_specs) if sp is not None]
    return reg.specs, melon_pairs


def resolve_official(spec: dict) -> dict:
    """정식 이름/아티스트 사진 확정. 이미 정해진(resolve=False 또는 시험지) 이름은 그대로 둠."""
    image = None
    if spec["resolve"] and not spec["official"] and spec["ko"] and HANGUL.search(spec["ko"]):
        found = main._resolve_official_korean_artist(spec["ko"], spec.get("latin_hint"))
        if found:
            spec["official"] = found["artist"]["name"]
            image = found["artist"].get("image")
    if not spec["official"]:
        spec["official"] = spec["ko"]
    spec["aliases"].add(spec["official"])
    if image:
        spec["image"] = image
    elif spec["sources"] == {"melon"}:
        spec["image"] = checked_artist_image(spec)
    else:
        spec["image"] = main.resolve_artist_image(spec["official"])
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
            "image": main.resolve_track_image(best_name, t["name"], t["_raw"].get("image", [])),
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
                        "image": main.resolve_track_image(a["official"], t["title"], []), "aliases": []}
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


def dedupe_artist_tracks(tracks: list) -> list:
    """한 아티스트 안의 같은 곡을 하나로: 괄호 부가정보를 뗀 정규화 제목("그 날"/"그 날 (Feat. 헤이즐)") 또는 한글 제목
    ("Haru Haru"의 한글 제목 "하루 하루" = "하루하루")이 같으면 같은 곡. 앞에 온 것(수동 > 멜론 > Last.fm 순)을 남기고
    뒤의 별칭/멜론 제목/이미지/청취자 수를 합침."""
    kept, key_owner = [], {}
    for t in tracks:
        keys = {k for k in (_title_key(t["title"]), _title_key(t.get("ko_title") or "")) if k}
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
            for title in t.get("seed_titles", []):  # 멜론 시드의 한글 제목(영문 제목은 색인 안 함)
                for variant in dict.fromkeys([title, main._strip_paren(title)]):
                    if HANGUL.search(variant):
                        claim(variant, "track", tid, PRIO_MELON, a["id"])
            if ko and not any(x in t["title"] for x in ("...",)):  # "한글 아티스트명 + 제목" 조합(창모 아름다워)
                for title in dict.fromkeys(filter(None, [t["title"], main._strip_paren(t["title"]), t.get("ko_title")])):
                    claim(f"{ko} {title}", "track", tid, PRIO_MELON, a["id"])

    artist_aliases, track_aliases, ambiguous = {}, {}, []
    for key in sorted(claims):
        cs = claims[key]
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
    specs, melon_pairs = collect_artist_specs(seed, melon_tracks, confident)
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
        for alias in a["aliases"] | {a["official"], a.get("ko") or ""}:
            alias_to_artist.setdefault(normalize(alias), a)
    for st in seed.get("tracks", []):  # 수동 시드 곡(최우선) — 그 아티스트 대표곡 맨 앞
        a = alias_to_artist.get(normalize(st["artist"]))
        if a is None:
            print(f"[build] 경고: 시드 곡 '{st['title']}'의 아티스트 '{st['artist']}'를 못 찾음 — 건너뜀")
            continue
        tl = tracks_by_artist[a["id"]]
        existing = next((t for t in tl if _title_key(t["title"]) == _title_key(st["title"])), None)
        if existing is None:
            existing = {"title": st["title"], "ko_title": st.get("ko_title"), "listeners": None, "url": "",
                        "image": st.get("image") or main.resolve_track_image(a["official"], st["title"], []),
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
                    "aliases": artist_aliases.get(a["id"], []), "image": a.get("image")}
                   for a in sorted(artists, key=lambda x: x["id"])]
    print(f"[build] 멜론 시드에서 새로 추가된 곡 {added}개, 모호 별칭 {len(ambiguous)}개")
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
