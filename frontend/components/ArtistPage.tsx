"use client";

import { useEffect, useState } from "react";
import { getArtistTopTracks, type Track } from "@/lib/api";
import CompactTrackRow from "./CompactTrackRow";

type ArtistPageProps = {
  // 화면 제목에 쓰는 표시 이름(한글 우선)
  artistName: string;
  // 곡 조회에 쓰는 정식 이름(검색 카드에서 열었을 때만 있음). 없으면 artistName으로 조회 — 백엔드가 한글 이름도
  // 같은 아티스트의 조회용 이름으로 바꿔 줌
  lookupName?: string | null;
  // 아티스트 본인 사진(검색 카드에서 열었을 때). 없으면 이니셜 — 첫 곡 커버를 대신 쓰면 첫 곡과 같은
  // 이미지가 두 번 보여서 어색했음
  imageUrl?: string | null;
  onClose: () => void;
  isFavorite: (track: Track) => boolean;
  onToggleFavorite: (track: Track) => void;
  onPlay: (track: Track) => void;
  // "▶ 재생" 버튼 — 맨 위 곡만이 아니라 목록 전체를 순서대로 이어서 재생
  onPlayAll?: (tracks: Track[]) => void;
  onAddToPlaylist?: (track: Track) => void;
  // ⋮ 메뉴의 "다음에 재생" / "대기열에 추가"
  onPlayNext?: (track: Track) => void;
  onAddToQueue?: (track: Track) => void;
};

// 아티스트 카드를 누르면 열리는 전체화면 "아티스트 페이지" — 그 아티스트의 인기곡을
// 세로 목록으로 많이(최대 30곡) 보여주고, 곡을 누르면 바로 재생함(애플 뮤직 아티스트 화면 참고).
export default function ArtistPage({
  artistName,
  lookupName,
  imageUrl,
  onClose,
  isFavorite,
  onToggleFavorite,
  onPlay,
  onPlayAll,
  onAddToPlaylist,
  onPlayNext,
  onAddToQueue,
}: ArtistPageProps) {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setTracks(null);
    setFailed(false);
    // 가사 필터 없이 더 많은 곡을 받음(상세 화면이라 목록이 풍성한 쪽이 낫다)
    getArtistTopTracks(lookupName || artistName, { limit: 30, lyricsOnly: false })
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
  }, [artistName, lookupName]);

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
            {/* 아티스트 본인 사진(검색 카드에서 넘어온 것). 없으면 이니셜. */}
            {(() => {
              const artistImage = imageUrl;
              return artistImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={artistImage} alt="" className="h-20 w-20 shrink-0 rounded-full object-cover" />
              ) : (
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-white/10 text-3xl font-bold text-white/60">
                  {artistName.trim().charAt(0).toUpperCase()}
                </div>
              );
            })()}
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

          {/* 곡마다 ＋/★ 버튼 두 개 대신 오른쪽 ⋮ 메뉴 하나로 통일(다른 목록과 같은 CompactTrackRow) */}
          <ul>
            {tracks?.map((track, idx) => (
              <li key={`${track.artist}-${track.name}-${idx}`} className="flex items-center gap-1">
                <span className="w-5 shrink-0 text-center text-xs text-white/40">{idx + 1}</span>
                <div className="min-w-0 flex-1">
                  <CompactTrackRow
                    title={track.name}
                    subtitle={track.artist}
                    image={track.image}
                    isFavorite={isFavorite(track)}
                    onPlay={() => onPlay(track)}
                    onToggleFavorite={() => onToggleFavorite(track)}
                    onAddToPlaylist={onAddToPlaylist ? () => onAddToPlaylist(track) : undefined}
                    onPlayNext={onPlayNext ? () => onPlayNext(track) : undefined}
                    onAddToQueue={onAddToQueue ? () => onAddToQueue(track) : undefined}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
