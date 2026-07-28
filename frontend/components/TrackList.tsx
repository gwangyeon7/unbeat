import type { Track } from "@/lib/api";

type TrackListProps = {
  tracks: Track[];
  isFavorite: (track: Track) => boolean;
  onToggleFavorite: (track: Track) => void;
};

export default function TrackList({ tracks, isFavorite, onToggleFavorite }: TrackListProps) {
  if (tracks.length === 0) {
    return null;
  }

  return (
    <ul className="flex w-full max-w-xl flex-col gap-2">
      {tracks.map((track, idx) => (
        <li
          key={`${track.artist}-${track.name}-${idx}`}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-3 hover:border-white/30"
        >
          <a
            href={track.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-1 items-center justify-between"
          >
            <div>
              <p className="text-sm font-medium">{track.name}</p>
              <p className="text-xs text-white/50">{track.artist}</p>
            </div>
            <span className="text-xs text-white/40">
              {Number(track.listeners).toLocaleString()}명
            </span>
          </a>
          <button
            onClick={(e) => {
              e.preventDefault();
              onToggleFavorite(track);
            }}
            aria-label={isFavorite(track) ? "즐겨찾기 해제" : "즐겨찾기 추가"}
            className="px-2 text-lg text-yellow-400"
          >
            {isFavorite(track) ? "★" : "☆"}
          </button>
        </li>
      ))}
    </ul>
  );
}
