import Image from "next/image";
import type { Track } from "@/lib/api";

type TrackListProps = {
  tracks: Track[];
  isFavorite: (track: Track) => boolean;
  onToggleFavorite: (track: Track) => void;
  // 카드를 눌러 원곡 링크로 나갈 때(=재생 의도) 호출. 페이지 이동은 그대로 진행되고,
  // 이건 그 위에 얹는 부가 신호 기록이라 실패해도 클릭 자체를 막지 않음.
  onOpen?: (track: Track) => void;
};

export default function TrackList({ tracks, isFavorite, onToggleFavorite, onOpen }: TrackListProps) {
  if (tracks.length === 0) {
    return null;
  }

  return (
    <div className="flex w-full max-w-xl gap-3 overflow-x-auto pb-2">
      {tracks.map((track, idx) => (
        <a
          key={`${track.artist}-${track.name}-${idx}`}
          href={track.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onOpen?.(track)}
          className="group relative w-36 flex-shrink-0 rounded-lg border border-white/10 bg-white/5 p-2 transition hover:border-white/30"
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
              onClick={(e) => {
                e.preventDefault();
                onToggleFavorite(track);
              }}
              aria-label={isFavorite(track) ? "즐겨찾기 해제" : "즐겨찾기 추가"}
              className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 py-1 text-sm text-yellow-400 backdrop-blur"
            >
              {isFavorite(track) ? "★" : "☆"}
            </button>
          </div>
          <p className="mt-2 truncate text-sm font-medium">{track.name}</p>
          <p className="truncate text-xs text-white/50">{track.artist}</p>
          {track.listeners && (
            <p className="truncate text-[10px] text-white/30">
              {Number(track.listeners).toLocaleString()}명
            </p>
          )}
        </a>
      ))}
    </div>
  );
}
