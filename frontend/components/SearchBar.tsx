"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { searchSuggest, type SearchSuggestion } from "@/lib/api";

export type RecentSearchEntry = { query: string; image: string | null };

type SearchBarProps = {
  onSearch: (query: string, artist?: string) => void;
  isLoading?: boolean;
  recentSearches?: RecentSearchEntry[];
  onRemoveRecent?: (query: string) => void;
  // (모바일 하단 탭바 도입) "검색" 탭이 이 컴포넌트 내부의 모바일 전체화면 검색을 대신 열어줄 수
  // 있게 됨에 따라, 헤더에 있던 돋보기 아이콘 자체는 더 이상 안 보여줘도 됨(탭바와 기능이 겹침).
  // true면 그 아이콘 버튼만 숨기고, 전체화면 검색 로직/마크업 자체는 그대로 둠(ref로 열림).
  hideMobileTrigger?: boolean;
};

export type SearchBarHandle = {
  openMobileSearch: () => void;
  // 검색 결과에서 뒤로 나왔을 때 입력창에 남아있는 이전 검색어를 비움 (피드백 #5)
  clear: () => void;
};

const SearchBar = forwardRef<SearchBarHandle, SearchBarProps>(function SearchBar(
  { onSearch, isLoading, recentSearches = [], onRemoveRecent, hideMobileTrigger = false },
  ref
) {
  const [value, setValue] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  // (모바일 검색 UX 개편) 유튜브 뮤직/멜론 앱은 헤더에 검색창 전체를 항상 띄워두지 않고
  // 돋보기 아이콘만 두다가, 탭하면 그때 전체화면 검색 화면(뒤로가기 + 입력창 + 최근 검색)이
  // 열리는 패턴을 씀. "폰 규격끼리 공통적인 UX부터 맞추고 싶다"는 요청으로 이 패턴을 도입 —
  // 데스크톱(sm 이상)은 기존 상시 노출 입력창을 그대로 두고, 모바일(sm 미만)만 이 방식으로 바꿈.
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  // 유튜브 뮤직 검색창처럼 "numb"까지만 쳐도 "Numb Little Bug" 같은 후보가 뜨게 해달라는
  // 요청으로 추가 — 값이 없을 때는 기존처럼 '최근 검색'을, 두 글자 이상 입력하면 이 자동완성
  // 후보로 드롭다운 내용을 바꿔치기함.
  const [suggestions, setSuggestions] = useState<{ tracks: SearchSuggestion[]; artists: string[] }>({
    tracks: [],
    artists: [],
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mobileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const trimmed = value.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (trimmed.length < 2) {
      setSuggestions({ tracks: [], artists: [] });
      return;
    }
    // 매 키 입력마다 바로 호출하면 API 낭비가 크니, 타이핑이 잠깐 멈췄을 때만 호출(디바운스)
    debounceRef.current = setTimeout(() => {
      searchSuggest(trimmed)
        .then(setSuggestions)
        .catch(() => setSuggestions({ tracks: [], artists: [] }));
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value]);

  // 모바일 전체화면 검색이 열리는 순간 바로 타이핑할 수 있게 입력창에 포커스.
  useEffect(() => {
    if (isMobileOpen) {
      mobileInputRef.current?.focus();
    }
  }, [isMobileOpen]);

  // 하단 탭바의 "검색" 버튼이 외부(page.tsx)에서 이 전체화면 검색을 열 수 있게 노출.
  // state 자체를 끌어올리는 대신 ref로 메서드 하나만 노출한 이유: 내부 상태/로직(디바운스,
  // 자동완성, 최근 검색 등)은 전부 이 컴포넌트 안에 그대로 두고 싶어서(이미 잘 동작하던 걸
  // 건드릴 이유가 없음) — "열어라"는 명령 하나만 받으면 충분함.
  useImperativeHandle(ref, () => ({
    openMobileSearch: () => setIsMobileOpen(true),
    clear: () => {
      setValue("");
      setSuggestions({ tracks: [], artists: [] });
    },
  }));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) {
      onSearch(trimmed);
      setIsDropdownOpen(false);
      setIsMobileOpen(false);
    }
  }

  function handleSelectRecent(query: string) {
    setValue(query);
    onSearch(query);
    setIsDropdownOpen(false);
    setIsMobileOpen(false);
  }

  function handleSelectSuggestion(query: string, artist?: string) {
    setValue(query);
    onSearch(query, artist);
    setIsDropdownOpen(false);
    setIsMobileOpen(false);
  }

  const trimmedValue = value.trim();
  const isSuggestingMode = trimmedValue.length >= 2;
  const hasSuggestions = suggestions.tracks.length > 0 || suggestions.artists.length > 0;
  const showDropdown =
    isDropdownOpen && (isSuggestingMode ? hasSuggestions : recentSearches.length > 0);

  // 자동완성 후보 목록 — 데스크톱 드롭다운과 모바일 전체화면 검색이 똑같은 마크업을 쓰므로
  // 하나로 빼서 두 군데서 재사용(따로 관리하면 나중에 한쪽만 고치는 실수가 나기 쉬움).
  function renderSuggestionList() {
    return (
      <ul className="max-h-64 overflow-y-auto py-1 sm:max-h-64">
        {suggestions.tracks.map((track) => (
          <li key={`t-${track.artist}-${track.name}`}>
            <button
              type="button"
              // 클릭이 input의 onBlur(드롭다운 닫기)보다 먼저 처리되게 함 — 모바일 전체화면
              // 검색에는 onBlur로 안 닫는 로직이 없지만, 같은 핸들러를 공유하니 그대로 둠
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelectSuggestion(track.name, track.artist)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-white/80 hover:bg-white/5"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 shrink-0 text-white/30">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <span className="truncate">{track.name}</span>
              <span className="shrink-0 truncate text-white/30">{track.artist}</span>
            </button>
          </li>
        ))}
        {suggestions.artists.map((artist) => (
          <li key={`a-${artist}`}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelectSuggestion(artist)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-white/80 hover:bg-white/5"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 shrink-0 text-white/30">
                <circle cx="11" cy="11" r="7" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <span className="truncate">{artist}</span>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  // 최근 검색 목록 — 위 자동완성과 같은 이유로 데스크톱/모바일 공용.
  // (UI 재구조화, 2026-10-14) "화면이 텅 비어 보인다, 유튜브 뮤직처럼 위에 썸네일 카드로
  // 보여달라"는 요청으로 세로 텍스트 목록(시계 아이콘 + 글자)에서 가로 스크롤 썸네일 카드
  // 행으로 교체 — 각 카드는 그 검색의 첫 트랙/아티스트 이미지(없으면 음표 플레이스홀더) 위에
  // 검색어를 라벨로 붙임. 삭제 버튼은 카드 공간이 좁아서 옆이 아니라 카드 우상단에 작은 ✕로
  // 겹쳐서 올림(길게 눌러 지우는 느낌의 작은 오버레이 버튼).
  function renderRecentList() {
    return (
      <>
        <p className="px-4 pt-2 text-[10px] uppercase tracking-wide text-white/30">최근 검색</p>
        <ul className="scrollbar-none flex gap-3 overflow-x-auto px-4 py-3">
          {recentSearches.map(({ query, image }) => (
            <li key={query} className="w-24 shrink-0">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => handleSelectRecent(query)}
                  className="block h-24 w-24 overflow-hidden rounded-lg bg-white/10"
                >
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- 외부(Last.fm/iTunes/유튜브) 썸네일이라 next/image 최적화 대상이 아님(프로젝트 전역에서 동일 패턴)
                    <img src={image} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-white/20">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-6 w-6">
                        <path d="M9 18V5l12-2v13" />
                        <circle cx="6" cy="18" r="3" />
                        <circle cx="18" cy="16" r="3" />
                      </svg>
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  aria-label="최근 검색에서 삭제"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onRemoveRecent?.(query)}
                  className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/80 text-white/70 hover:text-white"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3 w-3">
                    <path d="M18 6 6 18" />
                    <path d="M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="mt-1.5 truncate text-center text-xs text-white/70">{query}</p>
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <div className="relative w-auto sm:w-full sm:max-w-xl">
      {/* 데스크톱(sm 이상) — 항상 펼쳐진 입력창 그대로 유지 */}
      <form onSubmit={handleSubmit} className="hidden w-full gap-2 sm:flex">
        {/* min-w-0: flex 아이템 기본값(min-width: auto)이 input의 내용 기반 최소 너비를 지키려고
            줄어들지 않아서, 좁은 화면(특히 카카오톡 인앱 브라우저처럼 레이아웃 엔진이 다른 곳)에서
            검색창+버튼이 화면 밖으로 밀려나던 문제 — 이 한 줄로 flex-1이 실제로 줄어들 수 있게 함. */}
        <div className="relative min-w-0 flex-1">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setIsDropdownOpen(true)}
            // blur가 드롭다운 클릭보다 먼저 발생해서 클릭이 씹히는 걸 막기 위해 살짝 지연 후 닫음
            onBlur={() => setTimeout(() => setIsDropdownOpen(false), 150)}
            placeholder="아티스트 또는 곡 제목을 검색해보세요 (예: 아이유, Blueming)"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 pr-10 text-sm outline-none focus:border-accent"
          />
          {value && (
            <button
              type="button"
              aria-label="검색어 지우기"
              // 클릭이 input의 onBlur보다 먼저 처리되게 mousedown에서 지움(안 그러면 blur가 먼저
              // 발생해 버튼이 사라지면서 클릭이 씹힘 — 위 '최근 검색' 삭제 버튼과 같은 이유의 setTimeout
              // 방식 대신, 여기선 onMouseDown으로 더 확실하게 처리)
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setValue("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-white/30 hover:bg-white/10 hover:text-white/60"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <path d="M18 6 6 18" />
                <path d="M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <button
          type="submit"
          disabled={isLoading}
          className="rounded-lg bg-accent px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
        >
          {isLoading ? "검색 중..." : "검색"}
        </button>
      </form>

      {showDropdown && isSuggestingMode && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 hidden overflow-hidden rounded-lg border border-white/10 bg-black shadow-lg sm:block">
          {renderSuggestionList()}
        </div>
      )}

      {showDropdown && !isSuggestingMode && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 hidden overflow-hidden rounded-lg border border-white/10 bg-black shadow-lg sm:block">
          {renderRecentList()}
        </div>
      )}

      {/* 모바일(sm 미만) — 돋보기 아이콘만 노출, 탭하면 전체화면 검색으로 전환.
          (하단 탭바 도입) 탭바의 "검색"이 같은 역할을 대신하게 돼서 hideMobileTrigger가 true면
          이 아이콘은 안 그림 — 전체화면 검색 자체(바로 아래)는 그대로 ref로 열 수 있음. */}
      {!hideMobileTrigger && (
        <button
          type="button"
          aria-label="검색"
          onClick={() => setIsMobileOpen(true)}
          className="flex h-11 w-11 items-center justify-center rounded-full text-white/80 hover:bg-white/10 sm:hidden"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </button>
      )}

      {/* 모바일 전체화면 검색 — 유튜브 뮤직/멜론처럼 뒤로가기 화살표 + 입력창 + 최근 검색(또는
          자동완성)을 화면 전체로 덮어서 보여줌. */}
      {/* header가 sticky + z-20으로 자체 stacking context를 만들어서, 이 안에 그냥 두면
          z-50을 줘도 header 바깥의 하단 탭바(z-30, 하단 탭바 도입으로 신규)보다 아래에
          깔려 버림 — createPortal로 body 바로 밑에 그려서 그 제약을 벗어나게 함. */}
      {isMobileOpen && createPortal(
        <div className="animate-slide-up-in fixed inset-0 z-50 flex h-screen w-screen flex-col bg-black sm:hidden">
          <form onSubmit={handleSubmit} className="flex items-center gap-2 border-b border-white/10 p-3">
            <button
              type="button"
              aria-label="검색 닫기"
              onClick={() => setIsMobileOpen(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/80 hover:bg-white/10"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <div className="relative min-w-0 flex-1">
              <input
                ref={mobileInputRef}
                type="text"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="아티스트 또는 곡 제목을 검색해보세요"
                className="w-full rounded-full border border-white/10 bg-white/5 px-4 py-2.5 pr-9 text-sm outline-none focus:border-accent"
              />
              {value && (
                <button
                  type="button"
                  aria-label="검색어 지우기"
                  onClick={() => setValue("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-white/30 hover:bg-white/10 hover:text-white/60"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                    <path d="M18 6 6 18" />
                    <path d="M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </form>
          <div className="flex-1 overflow-y-auto">
            {isSuggestingMode
              ? hasSuggestions && renderSuggestionList()
              : recentSearches.length > 0 && renderRecentList()}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
});

export default SearchBar;
