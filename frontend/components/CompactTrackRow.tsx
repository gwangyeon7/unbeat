"use client";

import Image from "next/image";
import { useState } from "react";

type CompactTrackRowProps = {
  title: string;
  subtitle: string;
  image?: string | null;
  isFavorite: boolean;
  onPlay: () => void;
  onToggleFavorite: () => void;
  onAddToPlaylist?: () => void;
  // 있으면 ⋮ 메뉴에 "이 아티스트 곡 보기"가 생김
  onViewArtist?: () => void;
};

// 유튜브 뮤직 "빠른 선곡"/"다시 듣기"처럼 작은 정사각 썸네일 + 2줄 텍스트로 된 가로 한 줄.
// "너무 다 카드트랙으로 만들 필요는 없다"는 피드백으로, 큰 정사각 카드(TrackList)보다
// 더 촘촘하게 여러 곡을 보여줘야 하는 자리(무드 탐색 결과, 사이드바 다시 듣기)에 씀.
// (2026-10-25) 곡 옆에 ＋/★ 버튼 두 개가 같이 있어 난잡하다는 피드백으로, 유튜브 뮤직처럼 ⋮ 버튼
// 하나만 두고 누르면 바텀시트 메뉴(재생목록 추가/즐겨찾기/아티스트 곡 보기)가 뜨게 바꿈.
export default function CompactTrackRow({
  title,
  subtitle,
  image,
  isFavorite,
  onPlay,
  onToggleFavorite,
  onAddToPlaylist,
  onViewArtist,
}: CompactTrackRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  function runAndClose(action?: () => void) {
    setMenuOpen(false);
    action?.();
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPlay();
        }
      }}
      className="group flex min-w-0 cursor-pointer items-center gap-3 rounded-md p-1 text-left hover:bg-white/5"
    >
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded bg-gradient-to-br from-accent/30 to-white/5">
        {image ? (
          <Image src={image} alt={title} fill sizes="48px" className="object-cover" unoptimized />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4 text-white/25"
              aria-hidden="true"
            >
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-white/50">{subtitle}</p>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen(true);
        }}
        aria-label="더보기"
        className="shrink-0 rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>

      {menuOpen && (
        // 시트 밖/안 어디를 눌러도 이벤트가 뒤의 행(재생)으로 새지 않게 stopPropagation.
        <div
          className="animate-slide-up-in fixed inset-0 z-[60] flex items-end justify-center bg-black/60"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen(false);
          }}
        >
          <div
            className="w-full max-w-xl rounded-t-2xl border-t border-white/10 bg-neutral-900 pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
              <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded bg-white/5">
                {image && (
                  <Image src={image} alt={title} fill sizes="44px" className="object-cover" unoptimized />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{title}</p>
                <p className="truncate text-xs text-white/50">{subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="닫기"
                className="rounded-full p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
              >
                ✕
              </button>
            </div>
            {onAddToPlaylist && (
              <button
                type="button"
                onClick={() => runAndClose(onAddToPlaylist)}
                className="flex w-full items-center gap-4 px-5 py-3.5 text-left text-sm hover:bg-white/5"
              >
                <span className="w-5 text-center text-base">＋</span>
                재생목록에 추가
              </button>
            )}
            <button
              type="button"
              onClick={() => runAndClose(onToggleFavorite)}
              className="flex w-full items-center gap-4 px-5 py-3.5 text-left text-sm hover:bg-white/5"
            >
              <span className="w-5 text-center text-base text-yellow-400">{isFavorite ? "★" : "☆"}</span>
              {isFavorite ? "즐겨찾기 해제" : "즐겨찾기에 추가"}
            </button>
            {onViewArtist && (
              <button
                type="button"
                onClick={() => runAndClose(onViewArtist)}
                className="flex w-full items-center gap-4 px-5 py-3.5 text-left text-sm hover:bg-white/5"
              >
                <span className="w-5 text-center text-base">♪</span>
                이 아티스트 곡 보기
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
