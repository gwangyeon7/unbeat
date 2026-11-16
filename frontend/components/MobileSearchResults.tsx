"use client";

import { useState } from "react";
import type { Artist, Track } from "@/lib/api";
import CompactTrackRow from "./CompactTrackRow";

export type SearchFilter = "all" | "songs" | "artists";

export type SearchSongSection = {
  key: string;
  title: string;
  // 제목 아래 작은 안내(AI 추측/유튜브에서 찾음 등)
  note?: string | null;
  tracks: Track[];
  // 처음에 보여줄 곡 수(기본 8) — 아티스트 검색은 곡이 쫙 나오도록 크게 줌
  initialVisible?: number;
};

// 유튜브에서 가져온 제목에 &#39; 같은 HTML 엔티티가 그대로 섞여 오는 경우가 있어서 화면에 보일 때만 풀어줌
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

type MobileSearchResultsProps = {
  filter: SearchFilter;
  onFilterChange: (filter: SearchFilter) => void;
  artists: Artist[];
  artistNote?: string | null;
  isArtistFavorite: (artist: Artist) => boolean;
  onSelectArtist: (artistName: string) => void;
  onToggleFavoriteArtist: (artist: Artist) => void;
  // "전체"에서는 아티스트 다음에 이 순서대로(검색된 곡 → … → "OO의 다른 곡") 나옴
  songSections: SearchSongSection[];
  isTrackFavorite: (track: Track) => boolean;
  onToggleFavoriteTrack: (track: Track) => void;
  onPlay: (track: Track) => void;
  onAddToPlaylist: (track: Track) => void;
  onViewArtist: (track: Track) => void;
};

const FILTERS: { value: SearchFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "songs", label: "노래" },
  { value: "artists", label: "아티스트" },
];

// 섹션마다 처음엔 이만큼만 보여주고 "더보기"로 펼침
const INITIAL_VISIBLE = 8;

// 모바일(sm 미만) 검색 결과 — 멜론식 글자 탭(밑줄) + 스포티파이식 굵은 섹션 제목/아티스트 카드.
// 데스크톱은 page.tsx의 기존 가로 카드 섹션을 그대로 씀. 곡 행은 무드 탐색과 같은 CompactTrackRow라
// ⋮ 메뉴(담기/즐겨찾기/이 아티스트 곡 보기)와 재생 동작이 다른 목록과 똑같음.
export default function MobileSearchResults({
  filter,
  onFilterChange,
  artists,
  artistNote,
  isArtistFavorite,
  onSelectArtist,
  onToggleFavoriteArtist,
  songSections,
  isTrackFavorite,
  onToggleFavoriteTrack,
  onPlay,
  onAddToPlaylist,
  onViewArtist,
}: MobileSearchResultsProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const showArtists = filter !== "songs";
  const showSongs = filter !== "artists";
  const visibleSongSections = songSections.filter((s) => s.tracks.length > 0);

  function sectionHeader(title: string, note?: string | null, action?: React.ReactNode) {
    return (
      <div className="mb-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold text-white">{title}</h3>
          {note && <p className="text-xs text-white/40">{note}</p>}
        </div>
        {action}
      </div>
    );
  }

  // 아티스트 원형 사진(없으면 이름 첫 글자 아바타)
  function artistAvatar(artist: Artist, sizeClass: string) {
    return artist.image ? (
      // eslint-disable-next-line @next/next/no-img-element -- 외부(Deezer/iTunes) 이미지라 next/image 최적화 대상이 아님
      <img src={artist.image} alt="" className={`${sizeClass.split(" ").slice(0, 2).join(" ")} shrink-0 rounded-full object-cover`} />
    ) : (
      <div
        className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full bg-white/10 font-bold text-white/60`}
      >
        {artist.name.trim().charAt(0).toUpperCase()}
      </div>
    );
  }

  // 즐겨찾기 별 토글 — 누르기 쉽게 버튼 영역을 넉넉하게
  function favoriteStar(artist: Artist, buttonClass: string, iconClass: string) {
    const favorite = isArtistFavorite(artist);
    return (
      <button
        type="button"
        onClick={() => onToggleFavoriteArtist(artist)}
        aria-label={favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
        aria-pressed={favorite}
        className={`${buttonClass} flex shrink-0 items-center justify-center rounded-full text-yellow-400 hover:bg-white/10`}
      >
        <svg
          viewBox="0 0 24 24"
          fill={favorite ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          className={iconClass}
          aria-hidden="true"
        >
          <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z" />
        </svg>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-8 sm:hidden">
      {/* 멜론식 글자 탭: 선택된 탭은 굵은 흰 글자 + 강조색 밑줄 */}
      <div className="-mt-1 flex gap-6 border-b border-white/10">
        {FILTERS.map(({ value, label }) => {
          const active = filter === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onFilterChange(value)}
              className={`-mb-px border-b-2 pb-2.5 text-sm ${
                active
                  ? "border-accent font-bold text-white"
                  : "border-transparent text-white/50 hover:text-white/70"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {showArtists && artists.length > 0 && (
        <section>
          {sectionHeader("아티스트", artistNote)}
          {artists.length === 1 ? (
            // 한 명이면 가로 카드: 큰 사진 + 이름/서브텍스트 + 오른쪽에 즐겨찾기 별(누르기 쉬운 크기)
            (() => {
              const artist = artists[0];
              return (
                <div className="flex items-center rounded-xl bg-white/5 p-3">
                  <button
                    type="button"
                    onClick={() => onSelectArtist(artist.name)}
                    className="flex min-w-0 flex-1 items-center gap-4 text-left"
                  >
                    {artistAvatar(artist, "h-20 w-20 text-2xl")}
                    <div className="min-w-0">
                      <p className="line-clamp-2 break-words text-base font-bold leading-tight text-white">
                        {artist.name}
                      </p>
                      <p className="mt-0.5 text-xs text-white/40">아티스트</p>
                    </div>
                  </button>
                  {favoriteStar(artist, "h-11 w-11", "h-6 w-6")}
                </div>
              );
            })()
          ) : (
            // 여러 명이면 스포티파이식 세로 카드(큰 원형 사진 + 이름 + 아래 별)를 가로로 넘겨 봄
            <ul className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-1">
              {artists.map((artist) => (
                <li key={artist.name} className="flex w-24 shrink-0 flex-col items-center gap-1 text-center">
                  <button
                    type="button"
                    onClick={() => onSelectArtist(artist.name)}
                    className="flex w-full flex-col items-center gap-2"
                  >
                    {artistAvatar(artist, "h-24 w-24 text-2xl")}
                    <span className="line-clamp-2 w-full break-words text-sm font-medium leading-tight text-white">
                      {artist.name}
                    </span>
                  </button>
                  {favoriteStar(artist, "h-9 w-9", "h-5 w-5")}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {showSongs &&
        visibleSongSections.map((section) => {
          const isOpen = expanded.has(section.key);
          const limit = section.initialVisible ?? INITIAL_VISIBLE;
          const shown = isOpen ? section.tracks : section.tracks.slice(0, limit);
          const hasMore = !isOpen && section.tracks.length > limit;
          return (
            <section key={section.key}>
              {sectionHeader(
                section.title,
                section.note,
                hasMore ? (
                  <button
                    type="button"
                    onClick={() => setExpanded((prev) => new Set(prev).add(section.key))}
                    className="flex shrink-0 items-center gap-0.5 pb-0.5 text-sm text-white/60 active:text-white"
                  >
                    더보기
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4"
                      aria-hidden="true"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </button>
                ) : null
              )}
              <div className="flex flex-col gap-1">
                {shown.map((track, idx) => (
                  <CompactTrackRow
                    key={`${track.artist}-${track.name}-${idx}`}
                    title={decodeEntities(track.name)}
                    subtitle={decodeEntities(track.artist)}
                    image={track.image}
                    isFavorite={isTrackFavorite(track)}
                    onPlay={() => onPlay(track)}
                    onToggleFavorite={() => onToggleFavoriteTrack(track)}
                    onAddToPlaylist={() => onAddToPlaylist(track)}
                    onViewArtist={() => onViewArtist(track)}
                  />
                ))}
              </div>
            </section>
          );
        })}

      {filter === "artists" && artists.length === 0 && (
        <p className="text-sm text-white/40">검색된 아티스트가 없어요.</p>
      )}
      {filter === "songs" && visibleSongSections.length === 0 && (
        <p className="text-sm text-white/40">검색된 곡이 없어요.</p>
      )}
    </div>
  );
}
