"use client";

import { useEffect, useState } from "react";
import SearchBar from "@/components/SearchBar";
import ArtistCard from "@/components/ArtistCard";
import TrackList from "@/components/TrackList";
import MoodChips, { MOODS } from "@/components/MoodChips";
import RecentSearches from "@/components/RecentSearches";
import FavoriteTagSummary from "@/components/FavoriteTagSummary";
import {
  search,
  recommendByArtist,
  discoverByMood,
  getRecentSearches,
  type Artist,
  type Track,
  type RecentSearchArtist,
} from "@/lib/api";
import {
  getFavorites,
  addFavorite,
  removeFavorite,
  getFavoriteTracks,
  addFavoriteTrack,
  removeFavoriteTrack,
  markFavoriteTrackOpened,
  type Favorite,
  type FavoriteTrack,
} from "@/lib/playlistApi";

export default function Home() {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [searchTracks, setSearchTracks] = useState<Track[]>([]);
  const [correctedArtistName, setCorrectedArtistName] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isRecommending, setIsRecommending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [favoriteTracks, setFavoriteTracks] = useState<FavoriteTrack[]>([]);
  const [recentSearches, setRecentSearches] = useState<RecentSearchArtist[]>([]);

  // 홈 화면 무드 탐색용 상태 — 검색과는 별개 흐름
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [moodTracks, setMoodTracks] = useState<Track[]>([]);
  const [isLoadingMood, setIsLoadingMood] = useState(false);

  useEffect(() => {
    // 즐겨찾기 서비스(playlist-service)가 꺼져있어도 검색/추천은 그대로 동작해야 하니
    // 여기 실패는 조용히 무시한다 (즐겨찾기 별표만 안 보일 뿐).
    getFavorites()
      .then(setFavorites)
      .catch(() => setFavorites([]));
    getFavoriteTracks()
      .then(setFavoriteTracks)
      .catch(() => setFavoriteTracks([]));
    getRecentSearches()
      .then((data) => setRecentSearches(data.artists))
      .catch(() => setRecentSearches([]));
  }, []);

  async function handleSearch(query: string) {
    setError(null);
    setIsSearching(true);
    setSelectedArtist(null);
    setSelectedMood(null);
    setTracks([]);
    try {
      const data = await search(query);
      setArtists(data.artists);
      setSearchTracks(data.tracks);
      setCorrectedArtistName(data.correctedArtistName);
      // 검색 성공 시 사이드바 '최근 검색' 목록도 같이 갱신 (백엔드에 이미 로깅된 이벤트를 다시 조회)
      getRecentSearches()
        .then((res) => setRecentSearches(res.artists))
        .catch(() => {});
    } catch (err) {
      setError("검색에 실패했어요. 백엔드 서버가 켜져있는지 확인해주세요.");
      setArtists([]);
      setSearchTracks([]);
      setCorrectedArtistName(null);
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

  async function handleSelectMood(tag: string) {
    setError(null);
    setSelectedMood(tag);
    setIsLoadingMood(true);
    setMoodTracks([]);
    try {
      const data = await discoverByMood(tag);
      setMoodTracks(data.tracks);
    } catch (err) {
      setError("무드 곡을 불러오지 못했어요.");
    } finally {
      setIsLoadingMood(false);
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
        const saved = await addFavoriteTrack(track.artist, track.name, track.url);
        setFavoriteTracks((prev) => [saved, ...prev]);
      }
    } catch (err) {
      setError("트랙 즐겨찾기 처리에 실패했어요. playlist-service(8081)가 켜져있는지 확인해주세요.");
    }
  }

  const isTrackFavorite = (track: Track) =>
    favoriteTracks.some((f) => f.artistName === track.artist && f.trackName === track.name);

  // 즐겨찾기한 곡 카드를 눌러 원곡 링크로 나갈 때 "재생 의도" 신호를 기록.
  // 즐겨찾기 안 한 곡(추천/무드 목록에만 있는 곡)은 애초에 추적 대상이 아니라서 조용히 넘어감.
  // 새 탭으로 나가는 흐름을 막으면 안 되니 실패해도 무시(장애 격리와 같은 원칙).
  function handleOpenTrack(track: Track) {
    const existing = favoriteTracks.find(
      (f) => f.artistName === track.artist && f.trackName === track.name
    );
    if (!existing) return;
    markFavoriteTrackOpened(existing.id).catch(() => {});
  }

  // 태그 기반 자동 그룹핑: 한 곡이 여러 태그(장르+무드 등)를 가질 수 있어서
  // 대표 태그 1개가 아니라 가진 태그 전부에 넣음 (예: "DANCE"이자 "SUMMER"인 곡은 두 그룹 모두에 보임).
  // 케이팝처럼 태그가 얕게 붙는 경우까지 고려해서, 저장은 이미 최대 3개까지 해뒀던 걸 여기서 다 활용.
  const tracksByTag = favoriteTracks.reduce<Record<string, FavoriteTrack[]>>((groups, track) => {
    const tagsToUse = track.tags.length > 0 ? track.tags : ["태그 없음"];
    tagsToUse.forEach((tag) => {
      groups[tag] = [...(groups[tag] ?? []), track];
    });
    return groups;
  }, {});

  const selectedMoodLabel = MOODS.find((m) => m.tag === selectedMood)?.label;

  return (
    <main className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 gap-6 px-6 py-16 lg:grid-cols-[200px_1fr_200px]">
      {/* 왼쪽 사이드바: 최근 검색 — 작은 화면에선 숨기고, 넓은 화면에서만 여백을 채움 */}
      <aside className="hidden lg:block">
        <div className="sticky top-16">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">
            최근 검색
          </h2>
          <RecentSearches artists={recentSearches} onSelect={handleSearch} />
        </div>
      </aside>

      <div className="flex flex-col items-center gap-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Unbeat</h1>
        <p className="mt-2 text-sm text-white/60">
          지금 기분/상황에 맞는 곡을 바로 골라 듣거나, 좋아하는 아티스트로 추천받아보세요.
        </p>
      </div>

      {/* 검색 없이 바로 탐색하는 흐름 — 유튜브 뮤직 홈 화면처럼 무드 칩부터 */}
      <div className="w-full max-w-xl">
        <h2 className="mb-2 text-sm font-semibold text-white/70">지금 기분은?</h2>
        <MoodChips selectedTag={selectedMood} onSelect={handleSelectMood} />
      </div>

      {isLoadingMood && <p className="text-sm text-white/50">곡 불러오는 중...</p>}

      {selectedMood && !isLoadingMood && (
        <div className="w-full max-w-xl">
          {moodTracks.length > 0 ? (
            <>
              <p className="mb-2 text-xs text-white/40">"{selectedMoodLabel}" 태그 인기곡</p>
              <TrackList
                tracks={moodTracks}
                isFavorite={isTrackFavorite}
                onToggleFavorite={handleToggleFavoriteTrack}
                onOpen={handleOpenTrack}
              />
            </>
          ) : (
            <p className="text-sm text-white/50">이 무드에 맞는 곡을 못 찾았어요.</p>
          )}
        </div>
      )}

      {favoriteTracks.length > 0 && (
        <div className="w-full max-w-xl">
          <h2 className="mb-2 text-sm font-semibold text-white/70">다시 듣기 (즐겨찾기한 곡 — 태그별)</h2>
          <div className="flex flex-col gap-3">
            {Object.entries(tracksByTag).map(([tag, tracksInTag]) => (
              <div key={tag}>
                <p className="mb-1 text-xs uppercase tracking-wide text-white/40">{tag}</p>
                <div className="flex flex-wrap gap-2">
                  {tracksInTag.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 py-1 pl-1 pr-3 text-xs"
                    >
                      {/* 별표는 항상 동작해야 함 — 링크(url)가 없는 예전 즐겨찾기도 해제는 할 수 있어야 하니까 */}
                      <button
                        onClick={() =>
                          handleToggleFavoriteTrack({
                            name: t.trackName,
                            artist: t.artistName,
                            listeners: null,
                            url: t.url ?? "",
                            image: null,
                          })
                        }
                        aria-label="즐겨찾기 해제"
                        className="rounded-full px-1.5 py-0.5 text-yellow-400 hover:bg-white/10"
                      >
                        ★
                      </button>
                      {t.url ? (
                        <a
                          href={t.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => markFavoriteTrackOpened(t.id).catch(() => {})}
                          className="hover:underline"
                        >
                          {t.trackName} · {t.artistName}
                        </a>
                      ) : (
                        // 이 컬럼(url)이 추가되기 전에 즐겨찾기한 곡이라 링크가 없음 —
                        // 다시 별표를 눌러 재저장하기 전까지는 눌러도 이동할 곳이 없어서 텍스트만 표시.
                        <span
                          title="예전에 즐겨찾기한 곡이라 링크 정보가 없어요. 별표로 해제 후 다시 즐겨찾기하면 연결돼요."
                          className="text-white/40"
                        >
                          {t.trackName} · {t.artistName}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="h-px w-full max-w-xl bg-white/10" />

      <div className="w-full max-w-xl">
        <h2 className="mb-2 text-sm font-semibold text-white/70">아티스트 또는 곡으로 찾기</h2>
        <SearchBar onSearch={handleSearch} isLoading={isSearching} />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {searchTracks.length > 0 && (
        <div className="w-full max-w-xl">
          <p className="mb-2 text-xs text-white/40">검색된 곡</p>
          <TrackList
            tracks={searchTracks}
            isFavorite={isTrackFavorite}
            onToggleFavorite={handleToggleFavoriteTrack}
            onOpen={handleOpenTrack}
          />
        </div>
      )}

      {artists.length > 0 && (
        <div className="w-full max-w-xl">
          <p className="mb-2 text-xs text-white/40">
            검색된 아티스트
            {correctedArtistName && (
              <span className="ml-1 text-white/30">
                (오타 교정: <span className="text-white/50">{correctedArtistName}</span>로 검색됨)
              </span>
            )}
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
        </div>
      )}

      {isRecommending && <p className="text-sm text-white/50">추천 트랙 불러오는 중...</p>}

      {tracks.length > 0 && (
        <div className="w-full max-w-xl">
          <p className="mb-2 text-xs text-white/40">"{selectedArtist}"와 비슷한 아티스트의 곡</p>
          <TrackList
            tracks={tracks}
            isFavorite={isTrackFavorite}
            onToggleFavorite={handleToggleFavoriteTrack}
            onOpen={handleOpenTrack}
          />
        </div>
      )}

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
      </div>

      {/* 오른쪽 사이드바: 즐겨찾기 태그 요약 — "다시 듣기"에서 이미 계산한 tracksByTag 재사용 */}
      <aside className="hidden lg:block">
        <div className="sticky top-16">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">
            즐겨찾기 태그 요약
          </h2>
          <FavoriteTagSummary tracksByTag={tracksByTag} />
        </div>
      </aside>
    </main>
  );
}
