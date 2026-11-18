"""별칭표(alias 카탈로그) — 자주 치는 검색어를 외부 호출 없이 바로 정답으로 돌려주기 위한 메모리 인덱스.

배경(2026-11-18): /search는 검색어마다 Last.fm/Deezer/iTunes 등을 불러 결과를 모으는데, 처음 치는 검색어는 수 초가
걸리고, "메테오"(창모 METEOR)처럼 한글 발음으로 친 곡 제목은 외부 소스가 아예 못 찾음. 그래서 검증된 정답을
backend/catalog/catalog.json에 적어두고, 검색어가 그 별칭과 정확히 같으면(정규화 후) 바로 응답함.

- 데이터: catalog.json (backend/catalog/build_catalog.py가 수동 목록 + manual_seed.json으로 생성)
    artists: id, official(정식 이름), ko(한글명), lookup(Last.fm 조회용 이름), aliases(색인되는 검색어), image
  표시 이름 규칙(2026-11-18): 화면에는 한글 이름(ko)이 있으면 한글, 없으면 정식 이름 — 아티스트 칸과 곡의 아티스트가
  같은 사람인데 "IU"/"아이유"로 다르게 보이던 문제. 응답의 name은 표시 이름, officialName은 정식 이름(새 필드).
    tracks : id, title, artist_id, ko_title, aliases(사람들이 치는 검색어, 한글 발음 포함), image, listeners, url
    ambiguous: 여러 항목에 걸려 별칭표로 단정하지 않는 검색어 목록(파이프라인으로 넘김)
- 인덱스: 서버 시작 시 한 번 읽어 "정규화된 별칭 -> 아티스트/곡 id" 사전을 메모리에 만듦.
  정규화 = NFKC + 소문자 + 글자/숫자만 남김(공백/특수문자 제거) — search_eval/run_eval.py의 norm()과 같은 규칙.
- 곡의 aliases에 있는 검색어만 곡 검색을 가로챔. 곡 제목 자체(예: "Whiplash", "Ditto")는 자동으로 별칭이 되지 않음 —
  흔한 영어 제목까지 가로채면 다른 가수의 같은 제목 곡(Metallica "Whiplash")을 못 찾게 되기 때문.
- 파일이 없거나 JSON이 깨져도 예외를 밖으로 던지지 않음: 인덱스가 비어 있으면 lookup()이 항상 None이라
  /search는 기존 파이프라인 그대로 동작함. 항목 하나가 잘못돼도 그 항목만 건너뜀.
- 이 모듈은 외부 API를 부르지 않음. 이미지가 비어 있으면 호출부가 넘겨준 "캐시 조회 전용" 함수로만 채움.
"""
import json
import os
import unicodedata
from typing import Callable, Optional

CATALOG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "catalog", "catalog.json")
CATALOG_TRACK_LIMIT = 10  # 아티스트 별칭 일치 시 채워주는 대표곡 수(파이프라인의 SEARCH_TRACK_RESULT_LIMIT와 같게)


def normalize(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "").lower()
    return "".join(ch for ch in s if ch.isalnum())


class AliasCatalog:
    def __init__(self):
        self.artists: dict = {}
        self.tracks: dict = {}
        self.tracks_by_artist: dict = {}
        self.index: dict = {}  # 정규화 별칭 -> {"artists": [id...], "tracks": [id...]}
        # 모호 별칭: 서로 다른 곡/아티스트에 걸리는 검색어("고백" 3곡). 생성기가 이미 색인에서 뺐지만, 손으로 고친
        # catalog.json에 다시 들어가도 단정해서 답하지 않게 여기서도 막음 -> 이 검색어는 항상 기존 파이프라인으로
        self.ambiguous: set = set()
        # 이름 -> 아티스트 id(정식/한글/조회용/별칭 전부). 검색어 가로채기(index)와 별개로, 이름 변환에만 씀
        # (아티스트 페이지가 "아이유"로 와도 "IU"로 와도 같은 아티스트 = 같은 조회용 이름)
        self.by_name: dict = {}
        self.loaded_from: Optional[str] = None

    def load(self, path: str = CATALOG_PATH) -> "AliasCatalog":
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            print(f"[catalog] 별칭표 파일 없음({path}) — 기존 검색 파이프라인만 사용")
            return self
        except Exception as e:  # JSON 깨짐/권한 등 — 서버는 계속 떠야 함
            print(f"[catalog] 별칭표 읽기 실패({path}): {e} — 기존 검색 파이프라인만 사용")
            return self

        skipped = 0
        for a in (data.get("artists") or []) if isinstance(data, dict) else []:
            try:
                aid = str(a["id"])
                self.artists[aid] = {
                    "id": aid,
                    "official": str(a["official"]),
                    "ko": a.get("ko") or None,
                    "lookup": a.get("lookup") or str(a["official"]),
                    "image": a.get("image") or None,
                }
                for name in [a["official"], a.get("ko"), a.get("lookup")] + list(a.get("aliases") or []):
                    key = normalize(name) if isinstance(name, str) else ""
                    if key:
                        self.by_name.setdefault(key, aid)
                # official(정식 영문 이름)은 표시용 — 색인은 aliases만. "Treasure"/"Crush" 같은 영어 단어 검색을
                # K팝 아티스트로 가로채지 않게, 영문 별칭은 build_catalog.py가 수동 시드에 있는 것만 aliases에 넣음.
                for alias in a.get("aliases") or []:
                    self._add(alias, "artists", aid)
            except Exception:
                skipped += 1
        for t in (data.get("tracks") or []) if isinstance(data, dict) else []:
            try:
                tid, aid = str(t["id"]), str(t["artist_id"])
                if aid not in self.artists:
                    raise KeyError(aid)
                self.tracks[tid] = {
                    "id": tid,
                    "title": str(t["title"]),
                    "artist_id": aid,
                    "ko_title": t.get("ko_title") or None,
                    "image": t.get("image") or None,
                    "listeners": t.get("listeners"),
                    "url": t.get("url") or "",
                }
                self.tracks_by_artist.setdefault(aid, []).append(tid)
                for alias in t.get("aliases") or []:
                    self._add(alias, "tracks", tid)
            except Exception:
                skipped += 1
        for item in (data.get("ambiguous") or []) if isinstance(data, dict) else []:
            key = normalize(item.get("alias") if isinstance(item, dict) else item)
            if key:
                self.ambiguous.add(key)
        self.loaded_from = path
        print(f"[catalog] 별칭표 로드: 아티스트 {len(self.artists)}명, 곡 {len(self.tracks)}곡, 별칭 {len(self.index)}개, "
              f"모호 별칭 {len(self.ambiguous)}개"
              + (f", 잘못된 항목 {skipped}개 건너뜀" if skipped else ""))
        return self

    def _add(self, alias, kind: str, item_id: str) -> None:
        key = normalize(alias) if isinstance(alias, str) else ""
        if not key:
            return
        bucket = self.index.setdefault(key, {"artists": [], "tracks": []})
        if item_id not in bucket[kind]:
            bucket[kind].append(item_id)

    def display_name(self, aid: str) -> str:
        """화면용 이름: 한글 이름이 있으면 한글, 없으면 정식 이름(YOASOBI처럼 한글명이 없는 아티스트는 영문 그대로)."""
        a = self.artists[aid]
        ko = a["ko"]
        return ko if ko and any("가" <= ch <= "힣" for ch in ko) else a["official"]

    def find_artist(self, name: str) -> Optional[dict]:
        """이름(전체, 괄호 앞, 괄호 안 순서)으로 아티스트를 찾음 — "RIIZE (라이즈)" 같은 Last.fm 표기도 찾게.
        반환: {"id", "display", "official", "lookup"} 또는 None. 메모리 조회만(외부 호출 없음)."""
        if not isinstance(name, str) or not name.strip():
            return None
        candidates = [name]
        if "(" in name and name.rstrip().endswith(")"):
            outer, _, inner = name.rstrip()[:-1].partition("(")
            candidates += [outer, inner]
        for cand in candidates:
            aid = self.by_name.get(normalize(cand))
            if aid:
                a = self.artists[aid]
                return {"id": aid, "display": self.display_name(aid), "official": a["official"], "lookup": a["lookup"]}
        return None

    def _artist_out(self, aid: str, artist_image: Callable[[str], Optional[str]]) -> dict:
        a = self.artists[aid]
        image = a["image"]
        if not image:
            try:
                image = artist_image(a["official"])
            except Exception:
                image = None
        # listeners를 비워두면 프론트의 "1위의 50% 미만 숨김" 규칙에 안 걸림(max가 0이라 필터 생략)
        display = self.display_name(aid)
        # name은 기존 키(프론트 호환) — 화면용 표시 이름. 조회는 officialName(새 필드)으로
        return {"name": display, "displayName": display, "officialName": a["official"],
                "mbid": None, "image": image, "listeners": None}

    def _track_out(self, tid: str, track_image: Callable[[str, str], Optional[str]]) -> dict:
        t = self.tracks[tid]
        a = self.artists[t["artist_id"]]
        artist_display = self.display_name(t["artist_id"])  # 아티스트 칸과 같은 규칙(한글 우선)
        name = f"{t['ko_title']} ({t['title']})" if t["ko_title"] and t["ko_title"] != t["title"] else t["title"]
        image = t["image"]
        if not image:
            for artist_name in filter(None, (a["official"], a["ko"])):
                try:
                    image = track_image(artist_name, t["title"])
                except Exception:
                    image = None
                if image:
                    break
        return {"name": name, "artist": artist_display, "artistOfficialName": a["official"],
                "listeners": t["listeners"], "url": t["url"], "image": image}

    def lookup(
        self,
        q: str,
        artist_image: Callable[[str], Optional[str]] = lambda name: None,
        track_image: Callable[[str, str], Optional[str]] = lambda artist, title: None,
    ) -> Optional[dict]:
        """검색어가 별칭과 정확히 같으면 /search와 같은 형식의 artists/tracks를 돌려줌. 아니면 None.
        - 곡 별칭 일치: 그 곡을 맨 위에(여러 곡이면 별칭표 순서대로), 아래에 그 곡 아티스트의 대표곡
        - 아티스트 별칭 일치: 그 아티스트를 아티스트 칸 맨 앞에, 대표곡을 곡 목록에 채움
        - 둘 다 일치("인디고" = 아티스트 인디고 + 저스디스 "IndiGO"): 곡 일치 곡 먼저, 그다음 아티스트 대표곡
        아티스트 칸에는 일치한 아티스트 다음에 일치한 곡의 아티스트도 붙임(곡에서 아티스트로 이동할 수 있게)."""
        key = normalize(q)
        if key in self.ambiguous:
            return None
        bucket = self.index.get(key)
        if not bucket:
            return None
        artist_ids = list(bucket["artists"])
        track_ids = list(bucket["tracks"])
        for tid in bucket["tracks"]:
            aid = self.tracks[tid]["artist_id"]
            if aid not in artist_ids:
                artist_ids.append(aid)
        # 일치한 아티스트의 대표곡, 그다음 일치한 곡의 아티스트 대표곡(곡만 일치해도 목록이 1곡으로 끝나지 않게)
        for aid in artist_ids:
            for tid in self.tracks_by_artist.get(aid, []):
                if tid not in track_ids:
                    track_ids.append(tid)
        return {
            "artists": [self._artist_out(aid, artist_image) for aid in artist_ids],
            "tracks": [self._track_out(tid, track_image) for tid in track_ids[:CATALOG_TRACK_LIMIT]],
            "matched": {"artists": bucket["artists"], "tracks": bucket["tracks"]},
        }


def load_catalog(path: str = CATALOG_PATH) -> AliasCatalog:
    """어떤 경우에도 예외 없이 AliasCatalog를 돌려줌(실패하면 빈 카탈로그)."""
    try:
        return AliasCatalog().load(path)
    except Exception as e:
        print(f"[catalog] 별칭표 초기화 실패: {e} — 기존 검색 파이프라인만 사용")
        return AliasCatalog()
