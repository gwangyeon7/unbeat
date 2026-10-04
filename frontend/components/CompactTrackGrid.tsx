"use client";

import { useState } from "react";
import type { Track } from "@/lib/api";
import CompactTrackRow from "./CompactTrackRow";

type CompactTrackGridProps = {
  tracks: Track[];
  isFavorite: (track: Track) => boolean;
  onToggleFavorite: (track: Track) => void;
  onPlay?: (track: Track) => void;
  onAddToPlaylist?: (track: Track) => void;
  // true면 페이지네이션 버튼 대신 3행 고정 + 가로 드래그 스크롤로 표시 (다시 듣기/빠른 선곡용).
  // 기본 false는 기존 무드 탐색/검색 결과 그리드 동작을 그대로 유지.
  scrollable?: boolean;
};

const COLUMNS = 3;
const ROWS_PER_PAGE = 3;
const PAGE_SIZE = COLUMNS * ROWS_PER_PAGE;

// 유튜브 뮤직 "빠른 선곡"을 참고한 3열 그리드 — 큰 카드 대신 촘촘한 줄 목록으로 더 많은 곡을
// 한눈에 보여줌. 원래는 페이지 크기(9개)를 넘으면 좌우 화살표로 다음 묶음을 보는 방식이었는데,
// "양을 늘리고 스크롤로 오른쪽으로 더 볼 수 있게 해달라"는 요청으로 scrollable 모드(3행 고정 +
// 가로 드래그 스크롤)를 추가함. 처음엔 "다시 듣기"/"빠른 선곡"에만 적용했다가, 이후 "무드 탐색
// 결과도 화살표 대신 스크롤로 바꿔달라"는 요청으로 그쪽도 scrollable로 전환함 — 이제 검색 결과
// 그리드만 기존 페이지네이션 방식을 유지.
export default function CompactTrackGrid({
  tracks,
  isFavorite,
  onToggleFavorite,
  onPlay,
  onAddToPlaylist,
  scrollable = false,
}: CompactTrackGridProps) {
  const [page, setPage] = useState(0);

  if (tracks.length === 0) {
    return null;
  }

  function renderRow(track: Track, idx: number) {
    return (
      <CompactTrackRow
        key={`${track.artist}-${track.name}-${idx}`}
        title={track.name}
        subtitle={track.artist}
        image={track.image}
        isFavorite={isFavorite(track)}
        onPlay={() => onPlay?.(track)}
        onToggleFavorite={() => onToggleFavorite(track)}
        onAddToPlaylist={onAddToPlaylist ? () => onAddToPlaylist(track) : undefined}
      />
    );
  }

  if (scrollable) {
    // (모바일 레이아웃 개선, 2026-10-04) "앱(좁은 화면)으로 보면 빠른 선곡 쪽이 답답하다"는
    // 피드백 — 데스크톱/모바일 구분 없이 카드 폭을 220px 고정으로 쓰다 보니, 44px 썸네일 +
    // 플러스/즐겨찾기 버튼 2개가 항상 자리를 차지해서 좁은 화면에선 제목/아티스트 텍스트가
    // 많이 눌렸던 것. 버튼을 없애는 대신(기능 유지), sm 미만 화면에서만 카드 폭을 260px로
    // 넓혀 숨 쉴 공간을 줌 — 한 화면에 보이는 카드 수는 줄어도 가로 스크롤은 그대로라 손실 없음.
    return (
      <div
        className="scrollbar-none grid w-full auto-cols-[minmax(260px,1fr)] grid-flow-col grid-rows-3 gap-x-4 overflow-x-auto pb-2 sm:auto-cols-[minmax(220px,1fr)]"
      >
        {tracks.map(renderRow)}
      </div>
    );
  }

  const totalPages = Math.ceil(tracks.length / PAGE_SIZE);
  const safePage = Math.min(page, totalPages - 1);
  const visible = tracks.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="w-full">
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-3">{visible.map(renderRow)}</div>
      {totalPages > 1 && (
        <div className="mt-2 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
            aria-label="이전"
            className="rounded-full border border-white/15 px-2 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-30"
          >
            ‹
          </button>
          <span className="text-[11px] text-white/30">
            {safePage + 1} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={safePage === totalPages - 1}
            aria-label="다음"
            className="rounded-full border border-white/15 px-2 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-30"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
