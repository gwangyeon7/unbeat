import type { Track } from "@/lib/api";

type TrackListProps = {
  tracks: Track[];
};

export default function TrackList({ tracks }: TrackListProps) {
  if (tracks.length === 0) {
    return null;
  }

  return (
    <ul className="flex w-full max-w-xl flex-col gap-2">
      {tracks.map((track, idx) => (
        <li key={`${track.artist}-${track.name}-${idx}`}>
          <a
            href={track.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3 hover:border-white/30"
          >
            <div>
              <p className="text-sm font-medium">{track.name}</p>
              <p className="text-xs text-white/50">{track.artist}</p>
            </div>
            <span className="text-xs text-white/40">
              {Number(track.listeners).toLocaleString()}명
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
