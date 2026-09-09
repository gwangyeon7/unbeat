import Image from "next/image";

type CompactTrackRowProps = {
  title: string;
  subtitle: string;
  image?: string | null;
  isFavorite: boolean;
  onPlay: () => void;
  onToggleFavorite: () => void;
  onAddToPlaylist?: () => void;
};

// 유튜브 뮤직 "빠른 선곡"/"다시 듣기"처럼 작은 정사각 썸네일 + 2줄 텍스트로 된 가로 한 줄.
// "너무 다 카드트랙으로 만들 필요는 없다"는 피드백으로, 큰 정사각 카드(TrackList)보다
// 더 촘촘하게 여러 곡을 보여줘야 하는 자리(무드 탐색 결과, 사이드바 다시 듣기)에 씀.
export default function CompactTrackRow({
  title,
  subtitle,
  image,
  isFavorite,
  onPlay,
  onToggleFavorite,
  onAddToPlaylist,
}: CompactTrackRowProps) {
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
      className="group flex min-w-0 cursor-pointer items-center gap-2 rounded-md p-1 text-left hover:bg-white/5"
    >
      <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded bg-gradient-to-br from-accent/30 to-white/5">
        {image ? (
          <Image src={image} alt={title} fill sizes="44px" className="object-cover" unoptimized />
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
      <div className="flex shrink-0 items-center gap-0.5 opacity-70 group-hover:opacity-100">
        {onAddToPlaylist && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAddToPlaylist();
            }}
            aria-label="재생목록에 추가"
            className="rounded-full px-1.5 py-1 text-sm text-white/50 hover:bg-white/10 hover:text-white"
          >
            ＋
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
          aria-label={isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
          className="rounded-full px-1.5 py-1 text-sm text-yellow-400 hover:bg-white/10"
        >
          {isFavorite ? "★" : "☆"}
        </button>
      </div>
    </div>
  );
}
