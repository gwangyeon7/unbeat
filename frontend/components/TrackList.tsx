import Image from "next/image";
import type { Track } from "@/lib/api";

type TrackListProps = {
  tracks: Track[];
  isFavorite: (track: Track) => boolean;
  onToggleFavorite: (track: Track) => void;
  // 카드를 누르면 사이트를 나가는 대신, 하단 미니 플레이어에서 바로 재생됨(유튜브 검색+임베드).
  // Last.fm은 스트리밍이 없는 메타데이터 서비스라 자체 재생 기능이 없어서, 대신 이 방식으로
  // "사이트 안에서 바로 들을 수 있게" 함.
  onPlay?: (track: Track) => void;
  // 즐겨찾기(별표)와 별개로, 사용자가 직접 만든 재생목록에 곡을 담는 버튼. 없으면(옵셔널) 버튼 자체를 숨김.
  onAddToPlaylist?: (track: Track) => void;
};

export default function TrackList({
  tracks,
  isFavorite,
  onToggleFavorite,
  onPlay,
  onAddToPlaylist,
}: TrackListProps) {
  if (tracks.length === 0) {
    return null;
  }

  return (
    <div className="flex w-full max-w-xl gap-3 overflow-x-auto pb-2">
      {tracks.map((track, idx) => (
        // 버튼(★) 안에 또 버튼을 넣을 수 없어서(HTML 명세상 버튼 중첩 불가) 카드 자체는
        // div + role="button"으로 만들고, 안쪽 즐겨찾기 버튼만 진짜 <button>으로 둠.
        <div
          key={`${track.artist}-${track.name}-${idx}`}
          role="button"
          tabIndex={0}
          onClick={() => onPlay?.(track)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onPlay?.(track);
            }
          }}
          className="group relative w-36 flex-shrink-0 cursor-pointer rounded-lg border border-white/10 bg-white/5 p-2 text-left transition hover:border-white/30"
        >
          <div className="relative aspect-square w-full overflow-hidden rounded-md bg-gradient-to-br from-accent/30 to-white/5">
            {track.image ? (
              <Image
                src={track.image}
                alt={track.name}
                fill
                sizes="144px"
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-8 w-8 text-white/25"
                  aria-hidden="true"
                >
                  <path d="M9 18V5l12-2v13" />
                  <circle cx="6" cy="18" r="3" />
                  <circle cx="18" cy="16" r="3" />
                </svg>
              </div>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(track);
              }}
              aria-label={isFavorite(track) ? "즐겨찾기 해제" : "즐겨찾기 추가"}
              className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-1 text-sm text-yellow-400 backdrop-blur"
            >
              {isFavorite(track) ? "★" : "☆"}
            </button>
            {onAddToPlaylist && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddToPlaylist(track);
                }}
                aria-label="재생목록에 추가"
                className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 py-1 text-sm text-white/80 backdrop-blur hover:text-white"
              >
                ＋
              </button>
            )}
            {/* 순전히 장식용 호버 오버레이 — inset-0로 카드 전체를 덮다 보니 DOM 순서상
                별표/＋ 버튼보다 나중에 그려져서 그 버튼들 위 클릭을 가로채는 버그가 있었음
                (별표를 눌러도 재생이 되던 원인). pointer-events-none으로 클릭을 그냥 통과시킴 —
                카드 자체에 이미 onClick(onPlay)이 있어서 이 오버레이가 클릭을 받을 필요가 없음. */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/30 group-hover:opacity-100">
              <span className="rounded-full bg-white/90 p-2 text-black">▶</span>
            </div>
          </div>
          <p className="mt-2 truncate text-sm font-medium">{track.name}</p>
          <p className="truncate text-xs text-white/50">{track.artist}</p>
          {track.listeners && (
            <p className="truncate text-[10px] text-white/30">
              {Number(track.listeners).toLocaleString()}명
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
