"use client";

import { useEffect, useState } from "react";
import SearchBar from "@/components/SearchBar";
import ArtistCard from "@/components/ArtistCard";
import TrackList from "@/components/TrackList";
import { searchArtist, recommendByArtist, type Artist, type Track } from "@/lib/api";
import {
  getFavorites,
  addFavorite,
  removeFavorite,
  getFavoriteTracks,
  addFavoriteTrack,
  removeFavoriteTrack,
  type Favorite,
  type FavoriteTrack,
} from "@/lib/playlistApi";

export default function Home() {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isRecommending, setIsRecommending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [favoriteTracks, setFavoriteTracks] = useState<FavoriteTrack[]>([]);

  useEffect(() => {
    // 즐겨찾기 서비스(playlist-service)가 꺼져있어도 검색/추천은 그대로 동작해야 하니
    // 여기 실패는 조용히 무시한다 (즐겨찾기 별표만 안 보일 뿐).
    getFavorites()
      .then(setFavorites)
      .catch(() => setFavorites([]));
    getFavoriteTracks()
      .then(setFavoriteTracks)
      .catch(() => setFavoriteTracks([]));
  }, []);

  async function handleSearch(artistName: string) {
    setError(null);
    setIsSearching(true);
    setSelectedArtist(null);
    setTracks([]);
    try {
      const data = await searchArtist(artistName);
      setArtists(data.artists);
    } catch (err) {
      setError("검색에 실패했어요. 백엔드 서버가 켜져있는지 확인해주세요.");
      setArtists([]);
    } finally {
      setIsSearching(false);
    }
  }

  async function handleSelectArtist(artistName: string) {
    setError(null);
    setSelectedArtist(artistName);
    setIsRecommending(true);
    setTracks([]);
    try {
      const data = await recommendByArtist(artistName);
      setTracks(data.tracks);
    } catch (err) {
      setError("추천 트랙을 불러오지 못했어요.");
    } finally {
      setIsRecommending(false);
    }
  }

  async function handleToggleFavorite(artist: Artist) {
    const existing = favorites.find((f) => f.artistName === artist.name);
    try {
      if (existing) {
        await removeFavorite(existing.id);
        setFavorites((prev) => prev.filter((f) => f.id !== existing.id));
      } else {
        const saved = await addFavorite(artist.name, artist.image);
        setFavorites((prev) => [saved, ...prev]);
      }
    } catch (err) {
      setError("즐겨찾기 처리에 실패했어요. playlist-service(8081)가 켜져있는지 확인해주세요.");
    }
  }

  async function handleToggleFavoriteTrack(track: Track) {
    const existing = favoriteTracks.find(
      (f) => f.artistName === track.artist && f.trackName === track.name
    );
    try {
      if (existing) {
        await removeFavoriteTrack(existing.id);
        setFavoriteTracks((prev) => prev.filter((f) => f.id !== existing.id));
      } else {
        // Last.fm 태그 조회 때문에 응답이 살짝 늦을 수 있음 (백그라운드에서 태그 가져와서 같이 저장)
        const saved = await addFavoriteTrack(track.artist, track.name);
        setFavoriteTracks((prev) => [saved, ...prev]);
      }
    } catch (err) {
      setError("트랙 즐겨찾기 처리에 실패했어요. playlist-service(8081)가 켜져있는지 확인해주세요.");
    }
  }

  // 태그 기반 자동 그룹핑: 곡마다 대표 태그(가장 많이 붙은 첫 번째 태그) 하나만 기준으로 묶음
  const tracksByTag = favoriteTracks.reduce<Record<string, FavoriteTrack[]>>((groups, track) => {
    const primaryTag = track.tags[0] ?? "태그 없음";
    groups[primaryTag] = [...(groups[primaryTag] ?? []), track];
    return groups;
  }, {});

  return (
    <main className="flex min-h-screen flex-col items-center gap-8 px-6 py-16">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Unbeat</h1>
        <p className="mt-2 text-sm text-white/60">
          좋아하는 아티스트를 검색하면, 비슷한 아티스트의 인기곡을 추천해드려요.
        </p>
      </div>

      <SearchBar onSearch={handleSearch} isLoading={isSearching} />

      {error && <p className="text-sm text-red-400">{error}</p>}

      {artists.length > 0 && (
        <div className="grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
          {artists.map((artist) => (
            <ArtistCard
              key={artist.name}
              artist={artist}
              isSelected={selectedArtist === artist.name}
              isFavorite={favorites.some((f) => f.artistName === artist.name)}
              onSelect={handleSelectArtist}
              onToggleFavorite={handleToggleFavorite}
            />
          ))}
        </div>
      )}

      {isRecommending && <p className="text-sm text-white/50">추천 트랙 불러오는 중...</p>}

      <TrackList
        tracks={tracks}
        isFavorite={(track) =>
          favoriteTracks.some((f) => f.artistName === track.artist && f.trackName === track.name)
        }
        onToggleFavorite={handleToggleFavoriteTrack}
      />

      {favorites.length > 0 && (
        <div className="w-full max-w-xl">
          <h2 className="mb-2 text-sm font-semibold text-white/70">내 즐겨찾기 (아티스트)</h2>
          <div className="flex flex-wrap gap-2">
            {favorites.map((f) => (
              <button
                key={f.id}
                onClick={() => handleSelectArtist(f.artistName)}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs hover:border-white/30"
              >
                ★ {f.artistName}
              </button>
            ))}
          </div>
        </div>
      )}

      {favoriteTracks.length > 0 && (
        <div className="w-full max-w-xl">
          <h2 className="mb-2 text-sm font-semibold text-white/70">내 즐겨찾기 (곡) — 태그별 자동 분류</h2>
          <div className="flex flex-col gap-3">
            {Object.entries(tracksByTag).map(([tag, tracksInTag]) => (
              <div key={tag}>
                <p className="mb-1 text-xs uppercase tracking-wide text-white/40">{tag}</p>
                <div className="flex flex-wrap gap-2">
                  {tracksInTag.map((t) => (
                    <span
                      key={t.id}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs"
                    >
                      ★ {t.trackName} · {t.artistName}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
