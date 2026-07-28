"use client";

import { useEffect, useState } from "react";
import SearchBar from "@/components/SearchBar";
import ArtistCard from "@/components/ArtistCard";
import TrackList from "@/components/TrackList";
import { searchArtist, recommendByArtist, type Artist, type Track } from "@/lib/api";
import { getFavorites, addFavorite, removeFavorite, type Favorite } from "@/lib/playlistApi";

export default function Home() {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isRecommending, setIsRecommending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Favorite[]>([]);

  useEffect(() => {
    // 즐겨찾기 서비스(playlist-service)가 꺼져있어도 검색/추천은 그대로 동작해야 하니
    // 여기 실패는 조용히 무시한다 (즐겨찾기 별표만 안 보일 뿐).
    getFavorites()
      .then(setFavorites)
      .catch(() => setFavorites([]));
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

      <TrackList tracks={tracks} />

      {favorites.length > 0 && (
        <div className="w-full max-w-xl">
          <h2 className="mb-2 text-sm font-semibold text-white/70">내 즐겨찾기</h2>
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
    </main>
  );
}
