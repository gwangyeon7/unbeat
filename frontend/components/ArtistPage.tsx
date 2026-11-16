"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { getArtistTopTracks, type Track } from "@/lib/api";

type ArtistPageProps = {
  artistName: string;
  onClose: () => void;
  isFavorite: (track: Track) => boolean;
  onToggleFavorite: (track: Track) => void;
  onPlay: (track: Track) => void;
  // "▶ 재생" 버튼 — 맨 위 곡만이 아니라 목록 전체를 순서대로 이어서 재생
  onPlayAll?: (tracks: Track[]) => void;
  onAddToPlaylist?: (track: Track) => void;
};

// 아티스트 카드를 누르면 열리는 전체화면 "아티스트 페이지" — 그 아티스트의 인기곡을
// 세로 목록으로 많이(최대 30곡) 보여주고, 곡을 누르면 바로 재생함(애플 뮤직 아티스트 화면 참고).
export default function ArtistPage({
  artistName,
  onClose,
  isFavorite,
  onToggleFavorite,
  onPlay,
  onPlayAll,
  onAddToPlaylist,
}: ArtistPageProps) {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setTracks(null);
    setFailed(false);
    // 가사 필터 없이 더 많은 곡을 받음(상세 화면이라 목록이 풍성한 쪽이 낫다)
    getArtistTopTracks(artistName, { limit: 30, lyricsOnly: false })
      .then((res) => {
        if (!cancelled) setTracks(res.tracks);
      })
      .catch(() => {
        if (!cancelled) {
          setTracks([]);
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [artistName]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black text-white">
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-4">
        <button onClick={onClose} aria-label="뒤로" className="text-xl text-white/80">
          ‹
        </button>
        <h2 className="flex-1 truncate text-center text-base font-bold">{artistName}</h2>
        <span className="w-6" />
      </header>

      <div className="flex-1 overflow-y-auto pb-24">
        <div className="mx-auto w-full max-w-xl px-4 py-5">
          <div className="mb-4 flex items-center gap-4">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10 text-3xl font-bold text-white/60">
              {artistName.trim().charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-2xl font-bold">{artistName}</p>
              <p className="text-xs text-white/50">인기곡</p>
            </div>
            {tracks && tracks.length > 0 && (
              <button
                onClick={() => (onPlayAll ? onPlayAll(tracks) : onPlay(tracks[0]))}
                className="rounded-full bg-accent px-4 py-2 text-sm font-bold text-white"
              >
                ▶ 재생
              </button>
            )}
          </div>

          {tracks === null && <p className="text-sm text-white/50">불러오는 중...</p>}
          {failed && (
            <p className="text-sm text-red-400">곡을 불러오지 못했어요. 잠시 후 다시 시도해주세요.</p>
          )}
          {tracks && tracks.length === 0 && !failed && (
            <p className="text-sm text-white/50">곡을 찾지 못했어요.</p>
          )}

          <ul className="divide-y divide-white/5">
            {tracks?.map((track, idx) => (
              <li
                key={`${track.artist}-${track.name}-${idx}`}
                className="flex items-center gap-3 py-2"
              >
                <button
                  onClick={() => onPlay(track)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="w-5 text-center text-xs text-white/40">{idx + 1}</span>
                  <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded bg-white/10">
                    {track.image && (
                      <Image
                        src={track.image}
                        alt={track.name}
                        fill
                        sizes="48px"
                        className="object-cover"
                        unoptimized
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{track.name}</p>
                    <p className="truncate text-xs text-white/50">{track.artist}</p>
                  </div>
                </button>
                {onAddToPlaylist && (
                  <button
                    onClick={() => onAddToPlaylist(track)}
                    aria-label="재생목록에 추가"
                    className="px-2 text-lg text-white/60"
                  >
                    +
                  </button>
                )}
                <button
                  onClick={() => onToggleFavorite(track)}
                  aria-label={isFavorite(track) ? "즐겨찾기 해제" : "즐겨찾기 추가"}
                  className="px-2 text-lg text-yellow-400"
                >
                  {isFavorite(track) ? "★" : "☆"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
