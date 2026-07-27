"use client";

import { useState } from "react";
import SearchBar from "@/components/SearchBar";
import ArtistCard from "@/components/ArtistCard";
import TrackList from "@/components/TrackList";
import { searchArtist, recommendByArtist, type Artist, type Track } from "@/lib/api";

export default function Home() {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isRecommending, setIsRecommending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
              onSelect={handleSelectArtist}
            />
          ))}
        </div>
      )}

      {isRecommending && <p className="text-sm text-white/50">추천 트랙 불러오는 중...</p>}

      <TrackList tracks={tracks} />
    </main>
  );
}
