"""검색 품질 채점기.

queries.csv의 각 검색어를 실제 /search로 호출해서, 결과 위쪽 TOP_N개 안에 "나와야 하는 것(expected)"이
있으면 정답으로 채점한다. 검색을 고칠 때마다 같은 시험지로 다시 돌려서 점수를 비교하는 용도.

사용법 (백엔드가 떠 있어야 함):
  python3 backend/search_eval/run_eval.py                 # 기본 http://localhost:8000
  python3 backend/search_eval/run_eval.py http://localhost:8011
  python3 backend/search_eval/run_eval.py https://<운영 백엔드 주소>   # 운영 점수 확인용

결과는 표로 출력하고 results/ 폴더에 날짜별 CSV로도 저장한다(전후 비교용).
외부 라이브러리 없이 표준 라이브러리만 사용. 비밀키는 쓰지 않음.
"""
import csv
import json
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

TOP_N = 3
HERE = Path(__file__).parent


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "").lower()
    return "".join(ch for ch in s if ch.isalnum())


def search(base: str, q: str):
    url = f"{base.rstrip('/')}/search?q={urllib.parse.quote(q)}"
    started = time.time()
    with urllib.request.urlopen(url, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return data, time.time() - started


def top_names(data: dict, kind: str):
    if kind == "artist":
        return [a.get("name", "") for a in data.get("artists", [])[:TOP_N]]
    # 곡은 "제목"과 "아티스트 제목" 둘 다로 비교할 수 있게 합쳐서 본다
    return [f"{t.get('artist', '')} {t.get('name', '')}" for t in data.get("tracks", [])[:TOP_N]]


def strip_paren(s: str) -> str:
    """'RIIZE (라이즈)' -> 'RIIZE' 처럼 괄호 안 표기를 걷어낸 이름."""
    out, depth = [], 0
    for ch in s or "":
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth = max(0, depth - 1)
        elif depth == 0:
            out.append(ch)
    return "".join(out)


VIDEO_MARKERS = ("mv", "방송", "비하인드", "직캠", "라이브", "live", "킬링보이스", "커버", "cover", "reaction", "리액션")


def looks_like_video(s: str) -> bool:
    """영상 제목형(MV·방송 클립·직캠 등)이면 정식 곡이 아니라고 본다."""
    low = (s or "").lower()
    return any(m in low for m in VIDEO_MARKERS)


def is_hit(names, expected: str, kind: str = "track", artist_hint: str = "") -> bool:
    wants = [norm(x) for x in expected.split("|") if x.strip()]
    hints = [norm(x) for x in (artist_hint or "").split("|") if x.strip()]
    for name in names:
        if kind == "track":
            if looks_like_video(name):
                continue  # MV·방송 클립·커버 영상은 정답으로 안 침
            n = norm(name)
            if any(w and w in n for w in wants) and (not hints or any(h in n for h in hints)):
                return True
            continue
        if kind == "artist":
            # 아티스트는 "정확히 같은 이름"만 인정 — 포함 검사를 하면 "RIIZE 라이즈 'D" 같은
            # 영상 제목형 가짜 아티스트도 정답으로 처리돼서 채점이 너무 후해짐.
            candidates = {norm(name), norm(strip_paren(name))}
            if any(w and w in candidates for w in wants):
                return True
        else:
            n = norm(name)
            if any(w and w in n for w in wants):
                return True
    return False


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
    rows = list(csv.DictReader(open(HERE / "queries.csv", encoding="utf-8")))
    results = []
    hits = 0
    print(f"{base} 에 연결해서 {len(rows)}개 검색어를 채점합니다...", flush=True)
    for i, row in enumerate(rows, 1):
        q, kind, expected = row["query"], row["type"], row["expected"]
        print(f"  [{i}/{len(rows)}] {q} ...", end=" ", flush=True)
        try:
            data, took = search(base, q)
            names = top_names(data, kind)
            ok = is_hit(names, expected, kind, row.get("artist", ""))
            err = ""
        except Exception as e:  # 한 검색어 실패가 전체 채점을 막지 않게
            names, took, ok, err = [], 0.0, False, str(e)[:60]
        hits += ok
        print(f"{'O' if ok else 'X'} ({took:.1f}s){' ' + err if err else ''}", flush=True)
        results.append((q, kind, expected, ok, took, " / ".join(names) or err))

    print(f"\n서버: {base}   기준: 위쪽 {TOP_N}개 안에 정답\n")
    print(f"{'결과':<4} {'검색어':<14} {'종류':<7} {'정답':<26} {'시간':>5}  실제 위쪽 결과")
    for q, kind, expected, ok, took, shown in results:
        print(f"{'O' if ok else 'X':<4} {q:<14} {kind:<7} {expected:<26} {took:>4.1f}s  {shown}")
    print(f"\n점수: {hits} / {len(results)}  ({hits * 100 // max(1, len(results))}%)")

    out_dir = HERE / "results"
    out_dir.mkdir(exist_ok=True)
    out = out_dir / f"{datetime.now():%Y%m%d_%H%M%S}.csv"
    with open(out, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["query", "type", "expected", "hit", "seconds", "top_results"])
        for q, kind, expected, ok, took, shown in results:
            w.writerow([q, kind, expected, int(ok), f"{took:.2f}", shown])
    print(f"저장: {out.relative_to(HERE.parent.parent)}")


if __name__ == "__main__":
    main()
