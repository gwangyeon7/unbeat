"use client";

import { useEffect, useRef, useState } from "react";
import SearchBar from "@/components/SearchBar";
import ArtistCard from "@/components/ArtistCard";
import TrackList from "@/components/TrackList";
import CompactTrackGrid from "@/components/CompactTrackGrid";
import MoodChips, { MOODS } from "@/components/MoodChips";
import MiniPlayer, { type NowPlayingTrack } from "@/components/MiniPlayer";
import FavoriteTrackRow from "@/components/FavoriteTrackRow";
import AddToPlaylistModal from "@/components/AddToPlaylistModal";
import PlaylistDetailOverlay from "@/components/PlaylistDetailOverlay";
import StaleTracksModal from "@/components/StaleTracksModal";
import {
  search,
  recommendByArtist,
  getArtistTopTracks,
  discoverByMood,
  getAiQuickPicks,
  getRecentSearches,
  removeRecentSearch,
  recordRecentPlay,
  getRecentPlays,
  getTopChart,
  getTopArtists,
  getYoutubeChart,
  searchYoutubeVideo,
  getSimilarTracks,
  type Artist,
  type Track,
} from "@/lib/api";
import {
  getFavorites,
  addFavorite,
  removeFavorite,
  getFavoriteTracks,
  addFavoriteTrack,
  removeFavoriteTrack,
  markFavoriteTrackOpened,
  getPlaylists,
  createPlaylist,
  deletePlaylist,
  getPlaylistTracks,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  generateAutoPlaylists,
  getStaleFavoriteTracks,
  type Favorite,
  type FavoriteTrack,
  type Playlist,
  type PlaylistTrack,
} from "@/lib/playlistApi";

// "빠른 선곡" 섹션에서, 같은 후보 목록이라도 새로고침마다 다르게 보이도록 순서를 섞는 데 씀.
// (Fisher-Yates) — 진짜 개인화 추천 AI는 이 프로젝트 범위 밖(ROADMAP 목표에 명시)이라, 최소한
// "고정된 차트처럼 안 느껴지게"라도 하려는 절충안.
function shuffleArray<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default function Home() {
  const [artists, setArtists] = useState<Artist[]>([]);
  const [searchTracks, setSearchTracks] = useState<Track[]>([]);
  // "2010년대 kpop"처럼 아티스트/곡 이름이 아니라 장르·연대 키워드로 검색했을 때, 백엔드가
  // Last.fm 태그 검색으로 보완해서 내려주는 "관련 곡" 목록 — 정확한 검색 결과(searchTracks)와는
  // 성격이 달라서 화면에서도 별도 섹션으로 분리해서 보여줌.
  const [tagSearchTracks, setTagSearchTracks] = useState<Track[]>([]);
  const [correctedArtistName, setCorrectedArtistName] = useState<string | null>(null);
  // (§53) "댓댓"처럼 검색어와 실제 결과가 안 닮았을 때, 왜 이 결과가 나왔는지 알려주기 위한
  // AI 추측 검색어 힌트 — 백엔드가 Claude Haiku 추측을 Last.fm으로 재검증한 뒤에만 채워줌.
  const [aiGuessedQuery, setAiGuessedQuery] = useState<string | null>(null);
  // (§59) Last.fm+AI 추측까지 다 실패해서 유튜브 자체 검색으로 찾은 "비검증" 결과일 때 true —
  // 이땐 청취자 수 등 정식 메타데이터가 없다는 걸 사용자에게 알려줘야 함.
  const [youtubeFallbackUsed, setYoutubeFallbackUsed] = useState(false);
  // (§61) "검색해도 검색된 곡 말고는 다 똑같다, 유튜브 뮤직처럼 검색과 관련된 곡이 홈에도 떴으면
  // 좋겠다"는 요청으로 추가. 검색된 아티스트(or 첫 트랙의 아티스트)의 다른 곡으로 채워서,
  // 검색 중엔 검색과 무관한 "지금 인기 있는 곡"/"인기 아티스트" 대신 이 섹션을 보여줌.
  const [searchArtistTracks, setSearchArtistTracks] = useState<Track[]>([]);
  const [searchContextArtist, setSearchContextArtist] = useState<string | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedArtist, setSelectedArtist] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isRecommending, setIsRecommending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [favoriteTracks, setFavoriteTracks] = useState<FavoriteTrack[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  // (§49) 홈 화면 "다시 듣기" 섹션용 — 원래 favoriteTracks(즐겨찾기)를 그대로 재사용했는데,
  // "즐겨찾기는 사이드바에 이미 따로 있는데 다시 듣기도 즐겨찾기를 보여주면 중복 아니냐"는
  // 지적을 받고 진짜 "최근에 재생 시작한 곡" 기록으로 분리함.
  const [recentPlays, setRecentPlays] = useState<Track[]>([]);

  // "즐겨찾기해놓고 오래 안 들은 곡"을 찾아서 지워도 될지 물어보는 정리 기능용 상태.
  // 원래 기본 6개월 — "몇 달이 적당한가"는 정답이 없는 판단이라 상수로 명시적으로 빼둠.
  // 학술제 데모 기준으로는 6개월치 데이터가 쌓여있을 리 없어서 기능 자체가 안 보이므로,
  // 데모용으로 1개월로 낮춤(서버 쪽 FavoriteTrackController.stale()도 같은 months
  // 쿼리파라미터를 그대로 받아서 필터링하므로 이 값만 바꾸면 됨).
  const STALE_MONTHS = 1;
  const [isCleanupOpen, setIsCleanupOpen] = useState(false);
  const [staleTracks, setStaleTracks] = useState<FavoriteTrack[]>([]);
  const [isLoadingStale, setIsLoadingStale] = useState(false);

  // 홈 화면 무드 탐색용 상태 — 검색과는 별개 흐름
  // "한국 노래랑 팝송 구분하고 싶다"는 피드백으로 국내/해외 두 목록으로 나눠서 보관
  const [selectedMood, setSelectedMood] = useState<string | null>(null);
  const [domesticMoodTracks, setDomesticMoodTracks] = useState<Track[]>([]);
  const [internationalMoodTracks, setInternationalMoodTracks] = useState<Track[]>([]);
  const [isLoadingMood, setIsLoadingMood] = useState(false);

  // 검색/무드 선택 전에도 중앙이 비어 보이지 않게, 홈 화면 기본으로 깔아둘 인기곡 차트.
  // "스포티파이/유튜브 뮤직처럼 홈이 여러 행으로 나뉘어 있으면 좋겠다"는 피드백을 받고
  // 차트 하나로 뭉쳐놨던 걸 글로벌/국내/아티스트 세 행으로 쪼갬.
  const [chartTracks, setChartTracks] = useState<Track[]>([]);
  // "국내 인기 차트"는 원래 Last.fm geo.getTopTracks였는데, 유튜브 API를 검색에만 쓰고 있어서
  // "왜 안 쓰는 느낌이냐"는 피드백을 받고 실제 유튜브 트렌딩(videos.list)으로 데이터 소스를 바꿈 —
  // 이름 추측(HANGUL_PATTERN)이 아니라 regionCode로 나뉘어서 국내/해외 구분이 더 정확함.
  const [krChartTracks, setKrChartTracks] = useState<Track[]>([]);
  // 위 교체와 짝을 이루는 신규 섹션 — 같은 유튜브 트렌딩 API를 US 리전으로 호출.
  const [usTrendingTracks, setUsTrendingTracks] = useState<Track[]>([]);
  const [topArtists, setTopArtists] = useState<Artist[]>([]);
  // "인기 있는 곡"은 실제 차트라 새로고침해도 안 바뀌는 게 맞는데, "유튜브 뮤직처럼 새로고침하면
  // 좀 달라졌으면 좋겠다"는 피드백을 받음 — 그렇다고 차트를 억지로 매번 흔들면 "순위"라는 의미가
  // 없어지니, 차트는 그대로 두고 "빠른 선곡"이라는 별도 섹션을 새로 만듦. 즐겨찾기 태그로 취향
  // 후보를 얻고(진짜 AI 추천은 ROADMAP에서 처음부터 범위 밖으로 뺐음), 그 후보를 새로고침마다
  // 무작위로 섞어서 보여주는 절충안 — 아래 useEffect에서 favoriteTracks/chartTracks가 준비되면 계산.
  const [quickPickTracks, setQuickPickTracks] = useState<Track[]>([]);

  // 하단 미니 플레이어 — 트랙 카드를 누르면 Last.fm 자체 페이지로 나가는 대신
  // 유튜브에서 이 곡을 찾아 사이트 안에서 바로 재생함 (우리는 자체 오디오 스트리밍 라이선스가 없어서
  // Last.fm으로 나가면 "그냥 Last.fm 따까리"처럼 느껴진다는 피드백을 받고 바꿈).
  // 유튜브 iframe 자체(로고/자막 버튼/재생바)를 그대로 보여주면 여전히 "남의 사이트를 빌려온 느낌"이라는
  // 추가 피드백을 받고, 재생/진행바 UI는 전부 MiniPlayer가 자체적으로 그림 — 여긴 videoId만 넘겨줌.
  const [nowPlaying, setNowPlaying] = useState<NowPlayingTrack | null>(null);

  // "다음 트랙" 큐 — 유튜브 뮤직처럼 곡이 끝나면 비슷한 곡으로 자동으로 이어졌으면 좋겠다는
  // 피드백으로 추가. 항상 "지금 재생 중인 곡과 비슷한 곡" 목록이라, 곡이 바뀔 때마다 다시 채움
  // (고정된 재생목록을 미리 만들어두는 게 아니라 라디오처럼 그때그때 이어지는 방식).
  //
  // (§47) 원래는 곡이 바뀔 때마다 큐 전체를 새 추천 목록으로 덮어썼는데, "큐에 있던 곡을 눌러서
  // 재생했더니 그 전에 떠 있던 다른 후보들이 다 사라진다, 나중에 듣고 싶을 수도 있는데"라는
  // 피드백을 받음. 그래서 refreshQueue를 "덮어쓰기"에서 "방금 재생 시작한 곡만 빼고 나머지는
  // 그대로 둔 채 새 추천을 뒤에 이어붙이는" 방식으로 바꿈 — 계속 자라나는 라디오 큐.
  const [queue, setQueue] = useState<Track[]>([]);
  // 큐가 무한정 커지는 걸 막는 상한선 — 넘으면 뒤쪽(가장 최근에 추가된, 아직 신뢰도가 검증 안 된)
  // 추천부터 잘라냄. "다음에 바로 이어질 곡" 순서(앞쪽)는 최대한 안 건드리기 위해 뒤를 자름.
  const MAX_QUEUE_SIZE = 40;

  // 사용자가 직접 이름 짓고 곡을 담는 재생목록 — 즐겨찾기(별표)와는 별개 도메인.
  // 태그로 자동 그룹핑하는 시도를 했다가 "그건 아까 내가 별로라고 한 태그 즐겨찾기랑 똑같다,
  // 유튜브처럼 내가 직접 재생목록을 만들고 싶다"는 명확한 피드백을 받고 이 기능으로 교체함.
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  // 재생목록마다 곡 목록을 펼쳐보기 전까진 안 불러옴(사이드바에 재생목록이 많아지면 전부 미리
  // 불러오는 게 낭비라서) — playlistId를 키로 캐싱.
  const [playlistTracksById, setPlaylistTracksById] = useState<Record<number, PlaylistTrack[]>>({});
  // 재생목록 이름을 누르면(사이드바 아코디언 대신) 멜론 스타일 전체화면 상세 화면이 열림 —
  // "재생목록을 따로 만들어달라"는 피드백으로 좁은 사이드바 안 펼치기 방식을 대체함.
  const [openPlaylistId, setOpenPlaylistId] = useState<number | null>(null);
  // "다시 듣기" 목록도 재생목록처럼 기본은 접어두고, 눌렀을 때만 펼쳐서 사이드바 공간을 덜 차지하게 함.
  const [isFavoriteTracksExpanded, setIsFavoriteTracksExpanded] = useState(false);
  const [isCreatingPlaylist, setIsCreatingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [isGeneratingPlaylists, setIsGeneratingPlaylists] = useState(false);
  // (모바일 헤더 개편) 즐겨찾기 아티스트/즐겨찾기 곡/재생목록은 데스크톱에선 좌우 사이드바로
  // 항상 보이는데, 폰 화면(sm 미만)에선 그 사이드바 자체가 안 보여서(hidden lg:block) 이 세
  // 기능을 볼 방법이 아예 없었음. 헤더에 "보관함" 아이콘을 추가해서 눌렀을 때 이 내용을
  // 전체화면 서랍(drawer)으로 대신 보여줌 — 실제 데이터/핸들러는 아래 사이드바와 완전히
  // 공유(renderFavoriteArtists/renderLibraryPanel)해서 로직이 두 군데로 갈라지지 않게 함.
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  // 트랙 카드의 "+" 버튼을 누르면(1곡) 또는 재생목록 상세 화면에서 여러 곡을 체크하고 "담기"를
  // 누르면(여러 곡) 이 상태가 채워지고, 화면 중앙에 AddToPlaylistModal이 뜸 — 항상 배열로 통일.
  const [addToPlaylistTracks, setAddToPlaylistTracks] = useState<
    { name: string; artist: string; image?: string | null }[] | null
  >(null);

  // 재생목록 상세 화면의 "이어재생"/"반복재생" — 체크한 곡들을 순서대로 재생하는 "수동 큐" 모드.
  // 평소엔 큐(queue state)가 항상 "지금 곡과 비슷한 곡"으로 자동 채워지는 라디오 방식인데,
  // 이 모드에서는 그 대신 사용자가 고른 고정된 목록을 그대로 소비해야 해서 별도 ref로 구분함
  // (렌더마다 새로 생성되는 handlePlay/handleTrackEnded 클로저에서도 항상 최신 값을 보려고 state
  // 대신 ref를 씀 — MiniPlayer의 onEndedRef와 같은 이유).
  const isManualQueueRef = useRef(false);
  // 반복재생일 때만 채워짐 — 수동 큐를 다 소비하면 이 목록의 처음으로 돌아가 다시 재생.
  const repeatListRef = useRef<Track[] | null>(null);

  function refreshPlaylists() {
    getPlaylists()
      .then(setPlaylists)
      .catch(() => {});
  }

  function openPlaylistDetail(playlistId: number) {
    setOpenPlaylistId(playlistId);
    if (!playlistTracksById[playlistId]) {
      getPlaylistTracks(playlistId)
        .then((tracks) => setPlaylistTracksById((prev) => ({ ...prev, [playlistId]: tracks })))
        .catch(() => setPlaylistTracksById((prev) => ({ ...prev, [playlistId]: [] })));
    }
  }

  async function handleCreatePlaylistSubmit() {
    const name = newPlaylistName.trim();
    if (!name) return;
    try {
      await createPlaylist(name);
      setNewPlaylistName("");
      setIsCreatingPlaylist(false);
      refreshPlaylists();
    } catch (err) {
      setError("재생목록 생성에 실패했어요. playlist-service(8081)가 켜져있는지 확인해주세요.");
    }
  }

  async function handleDeletePlaylist(playlistId: number) {
    try {
      await deletePlaylist(playlistId);
      setPlaylistTracksById((prev) => {
        const next = { ...prev };
        delete next[playlistId];
        return next;
      });
      // 상세 화면을 보고 있던 재생목록 자체가 삭제된 경우, 빈 화면이 남지 않게 닫아줌.
      setOpenPlaylistId((prev) => (prev === playlistId ? null : prev));
      refreshPlaylists();
    } catch (err) {
      setError("재생목록 삭제에 실패했어요.");
    }
  }

  // 재생목록 상세 화면의 개별 ✕(1곡)와 하단 액션바 "삭제"(여러 곡) 둘 다 여기로 옴 —
  // trackIds가 1개짜리 배열이냐 여러 개짜리 배열이냐 차이일 뿐 로직은 동일해서 하나로 합침.
  async function handleRemoveTracksFromPlaylist(playlistId: number, trackIds: number[]) {
    try {
      await Promise.all(trackIds.map((trackId) => removeTrackFromPlaylist(playlistId, trackId)));
      setPlaylistTracksById((prev) => ({
        ...prev,
        [playlistId]: (prev[playlistId] ?? []).filter((t) => !trackIds.includes(t.id)),
      }));
      refreshPlaylists();
    } catch (err) {
      setError("재생목록에서 곡을 지우지 못했어요.");
    }
  }

  // 트랙 카드/즐겨찾기 목록의 "+" 버튼(1곡) — 어느 재생목록에 담을지 고르는 모달을 띄움
  function handleOpenAddToPlaylist(track: { name: string; artist: string; image?: string | null }) {
    setAddToPlaylistTracks([track]);
  }

  // 재생목록 상세 화면에서 여러 곡을 체크하고 "담기"를 누르거나, 미니 플레이어 "다음 트랙" 탭에서
  // 큐 전체를 "재생목록에 저장"할 때 — 같은 모달을 여러 곡으로 띄움. 호출부마다 원본 타입이
  // 달라서(PlaylistTrack, Track) 항상 이 공통 형태로 변환해서 넘기게 함.
  function handleOpenBulkAddToPlaylist(tracks: { name: string; artist: string; image?: string | null }[]) {
    setAddToPlaylistTracks(tracks);
  }

  async function handleAddTracksToPlaylist(playlistId: number) {
    if (!addToPlaylistTracks || addToPlaylistTracks.length === 0) return;
    try {
      await Promise.all(
        addToPlaylistTracks.map((t) =>
          addTrackToPlaylist(playlistId, t.artist, t.name, null, t.image ?? null)
        )
      );
      refreshPlaylists();
      // 이미 펼쳐서 캐싱해둔 재생목록이면(=화면에 보이고 있으면) 곧바로 최신 곡 목록으로 갱신
      if (playlistTracksById[playlistId]) {
        getPlaylistTracks(playlistId)
          .then((tracks) => setPlaylistTracksById((prev) => ({ ...prev, [playlistId]: tracks })))
          .catch(() => {});
      }
    } catch (err) {
      setError("재생목록에 곡을 추가하지 못했어요.");
    }
  }

  // "새 재생목록 누르고 이름 정해서 곡 하나씩 넣는 건 뻔하다, 내가 들은 곡 분석해서 장르별로
  // 알아서 만들어졌으면 좋겠다"는 피드백으로 추가 — 즐겨찾기한 곡의 Last.fm 태그를 백엔드가 분석해서
  // 케이팝/발라드/힙합 같은 장르별 재생목록을 통째로 만들어줌.
  async function handleGenerateAutoPlaylists() {
    setIsGeneratingPlaylists(true);
    setError(null);
    try {
      await generateAutoPlaylists();
      refreshPlaylists();
    } catch (err) {
      setError("취향 분석에 실패했어요. 즐겨찾기한 곡이 2곡 이상 있는지 확인해주세요.");
    } finally {
      setIsGeneratingPlaylists(false);
    }
  }

  async function handleCreatePlaylistAndAddTrack(name: string) {
    try {
      const created = await createPlaylist(name);
      if (addToPlaylistTracks && addToPlaylistTracks.length > 0) {
        await Promise.all(
          addToPlaylistTracks.map((t) =>
            addTrackToPlaylist(created.id, t.artist, t.name, null, t.image ?? null)
          )
        );
      }
      refreshPlaylists();
    } catch (err) {
      setError("재생목록을 만들지 못했어요.");
    }
  }

  useEffect(() => {
    // 즐겨찾기 서비스(playlist-service)가 꺼져있어도 검색/추천은 그대로 동작해야 하니
    // 여기 실패는 조용히 무시한다 (즐겨찾기 별표만 안 보일 뿐).
    getFavorites()
      .then(setFavorites)
      .catch(() => setFavorites([]));
    getFavoriteTracks()
      .then(setFavoriteTracks)
      .catch(() => setFavoriteTracks([]));
    getRecentPlays()
      .then((data) => setRecentPlays(data.tracks))
      .catch(() => setRecentPlays([]));
    getPlaylists()
      .then(setPlaylists)
      .catch(() => setPlaylists([]));
    getRecentSearches()
      .then((data) => setRecentSearches(data.queries))
      .catch(() => setRecentSearches([]));
    getTopChart()
      .then((data) => setChartTracks(data.tracks))
      .catch(() => setChartTracks([]));
    getYoutubeChart("KR")
      .then((data) => setKrChartTracks(data.tracks))
      .catch(() => setKrChartTracks([]));
    getYoutubeChart("US")
      .then((data) => setUsTrendingTracks(data.tracks))
      .catch(() => setUsTrendingTracks([]));
    getTopArtists()
      .then((data) => setTopArtists(data.artists))
      .catch(() => setTopArtists([]));
  }, []);

  // "빠른 선곡" — 처음엔 즐겨찾기 태그 중 제일 많은 태그로 tag.getTopTracks를 돌렸는데, 실사용
  // 중 "pop"처럼 흔한 태그를 고르면 그 순간 Last.fm에서 제일 많이 스크로블되는(=차트를 뒤덮은)
  // 아티스트가 태그 차트에도 그대로 나타나서, "인기 있는 곡"과 "빠른 선곡"이 똑같이 한 아티스트로
  // 도배되는 문제가 있었음. 태그(넓은 장르) 대신 즐겨찾기한 아티스트 중 하나를 무작위로 골라
  // artist.getSimilar 기반 추천(/recommend, 기존 재사용)을 쓰도록 바꿔서 해결했었는데(§37),
  // "유튜브 뮤직처럼 실제 AI 추천을 써보고 싶다"는 요청으로 즐겨찾기 전체를 LLM(Claude Haiku 4.5)에게
  // 보여주고 새 곡을 추천받는 방식을 우선 시도하도록 바꿈(§38, 이 프로젝트 첫 유료 API) — 백엔드에
  // ANTHROPIC_API_KEY가 없거나 호출이 실패하면 조용히 기존 아티스트 기반 방식으로 폴백한다.
  useEffect(() => {
    if (favoriteTracks.length === 0) {
      if (chartTracks.length > 0) setQuickPickTracks(shuffleArray(chartTracks).slice(0, 15));
      return;
    }

    function fallbackToArtistBased() {
      const favoriteArtists = [...new Set(favoriteTracks.map((t) => t.artistName))];
      const pickedArtist = favoriteArtists[Math.floor(Math.random() * favoriteArtists.length)];
      recommendByArtist(pickedArtist)
        .then((data) => setQuickPickTracks(shuffleArray(data.tracks).slice(0, 15)))
        .catch(() => {
          if (chartTracks.length > 0) setQuickPickTracks(shuffleArray(chartTracks).slice(0, 15));
        });
    }

    getAiQuickPicks(favoriteTracks.map((t) => ({ artist: t.artistName, name: t.trackName })))
      .then((data) => {
        if (data.tracks.length > 0) {
          setQuickPickTracks(shuffleArray(data.tracks).slice(0, 15));
        } else {
          fallbackToArtistBased();
        }
      })
      .catch(fallbackToArtistBased);
    // favoriteTracks/chartTracks가 나중에 채워지면(비동기 로딩) 그때 다시 계산되게 의존성에 둠 —
    // 매 렌더마다 다시 섞이면 스크롤/재생 중에도 계속 바뀌어 버리니, 두 값이 실제로 바뀔 때만.
  }, [favoriteTracks, chartTracks]);

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
      setTagSearchTracks(data.tagTracks);
      setCorrectedArtistName(data.correctedArtistName);
      setAiGuessedQuery(data.aiGuessedQuery);
      setYoutubeFallbackUsed(data.youtubeFallbackUsed);
      // 검색 성공 시 드롭다운 '최근 검색' 목록도 같이 갱신
      getRecentSearches()
        .then((res) => setRecentSearches(res.queries))
        .catch(() => {});

      // (§61) 검색 결과에서 "맥락 아티스트"를 정함 — 아티스트 검색 결과가 있으면 그 첫 번째,
      // 없으면(곡만 검색된 경우) 첫 곡의 아티스트. 둘 다 없으면(결과 없음) 섹션 자체를 안 보여줌.
      //
      // (버그 수정) searchContextArtist는 여기서 바로 바뀌는데 searchArtistTracks는 아래 fetch가
      // 끝나야 바뀌어서, 그 사이 헤더는 새 아티스트("아이유"의 다른 곡)로 바뀌었는데 목록은 직전
      // 검색(예: "싸이")의 곡이 그대로 보이는 순간이 실제로 눈에 띔("아이유" 쳤는데 강남스타일이
      // 뜬 것처럼 보임). 새 fetch를 시작하기 전에 먼저 비워서, 로딩 중엔 섹션이 잠깐 안 보이는
      // 쪽을 택함(틀린 아티스트의 곡을 보여주는 것보단 나음).
      const contextArtist = data.artists[0]?.name ?? data.tracks[0]?.artist ?? null;
      setSearchContextArtist(contextArtist);
      setSearchArtistTracks([]);
      if (contextArtist) {
        getArtistTopTracks(contextArtist)
          .then((res) => setSearchArtistTracks(res.tracks))
          .catch(() => setSearchArtistTracks([]));
      }
    } catch (err) {
      setError("검색에 실패했어요. 백엔드 서버가 켜져있는지 확인해주세요.");
      setArtists([]);
      setSearchTracks([]);
      setTagSearchTracks([]);
      setCorrectedArtistName(null);
      setAiGuessedQuery(null);
      setYoutubeFallbackUsed(false);
      setSearchContextArtist(null);
      setSearchArtistTracks([]);
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
    setDomesticMoodTracks([]);
    setInternationalMoodTracks([]);
    // 검색 결과가 떠 있는 상태에서 무드 칩을 누르면, 이전 검색 결과("검색된 곡"/"검색된 아티스트")가
    // 밑에 그대로 남아있어서 메인이 안 바뀐 것처럼 보이는 문제 — handleSearch가 검색 시 무드를
    // 지우는 것과 대칭으로, 무드 선택 시에도 검색/추천 관련 상태를 지워서 메인을 무드 결과로 교체함.
    setArtists([]);
    setSearchTracks([]);
    setTagSearchTracks([]);
    setCorrectedArtistName(null);
    setSelectedArtist(null);
    setTracks([]);
    setSearchContextArtist(null);
    setSearchArtistTracks([]);
    try {
      const data = await discoverByMood(tag);
      setDomesticMoodTracks(data.domesticTracks);
      setInternationalMoodTracks(data.internationalTracks);
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

  // "정리하기" 버튼 — 절대 조용히 지우지 않고, 먼저 후보 목록을 불러와서 모달로 보여주고
  // 사용자가 고른 것만 지움("아무거나 삭제하면 그건 좀 그렇다"는 우려 반영).
  async function handleOpenCleanup() {
    setIsLoadingStale(true);
    setError(null);
    try {
      const tracks = await getStaleFavoriteTracks(STALE_MONTHS);
      setStaleTracks(tracks);
      setIsCleanupOpen(true);
    } catch (err) {
      setError("정리할 곡을 불러오지 못했어요.");
    } finally {
      setIsLoadingStale(false);
    }
  }

  async function handleDeleteStaleTracks(ids: number[]) {
    try {
      await Promise.all(ids.map((id) => removeFavoriteTrack(id)));
      setFavoriteTracks((prev) => prev.filter((f) => !ids.includes(f.id)));
    } catch (err) {
      setError("일부 곡을 지우지 못했어요.");
    } finally {
      setIsCleanupOpen(false);
    }
  }

  // 검색창 드롭다운 '최근 검색'에서 항목 하나 삭제. 낙관적으로 먼저 화면에서 지우고,
  // 실패해도 사용자 입장에선 "다시 검색하면 또 나타나는" 정도라 되돌릴 필요는 없음.
  function handleRemoveRecent(query: string) {
    setRecentSearches((prev) => prev.filter((q) => q !== query));
    removeRecentSearch(query).catch(() => {});
  }

  // 트랙 카드를 누르면 유튜브에서 이 곡을 찾아 하단 미니 플레이어로 바로 재생.
  // 검색은 아티스트+곡 이름만 있으면 되니, url이 없는 예전 즐겨찾기 곡도 이제 재생 가능해짐
  // (예전엔 url 컬럼이 없어서 링크가 아예 안 걸리는 곡들이 있었는데, 그 제약이 자연스럽게 해소됨).
  async function handlePlay(
    track: {
      name: string;
      artist: string;
      image?: string | null;
      videoId?: string | null;
    },
    // 재생목록 상세 화면의 "이어재생"/"반복재생"에서만 넘어옴 — 값이 있으면 "이 곡 다음엔
    // 이 목록을 그대로 이어서 틀어라"는 뜻이라, 아래에서 비슷한 곡 자동 추천(refreshQueue)
    // 대신 이 목록을 큐로 그대로 세팅함.
    options?: {
      manualNext?: Track[];
      // (§48) "지금 떠 있는 다음 트랙 큐 안에서" 고른 곡인지 구분하는 플래그. 자동 이어재생
      // (곡이 끝나서 queue[0]으로 넘어감)이나 큐 목록을 직접 클릭한 경우에만 true로 넘어옴 —
      // 이때만 "같은 라디오 세션이 계속 이어지는 중"이라 보고 기존 큐를 유지한 채 이어붙임.
      // 검색/차트/즐겨찾기/재생목록처럼 큐 바깥에서 완전히 다른 곡을 골랐을 땐 false(기본값)로
      // 남아서, 이전 곡과 장르가 전혀 다른 후보들이 새 큐에 섞여 들어가지 않도록 통째로 새로 채움.
      fromQueue?: boolean;
    }
  ) {
    setError(null);
    try {
      // 유튜브 인기 급상승(getYoutubeChart) 트랙은 videoId를 이미 알고 있어서, 굳이 다시
      // /youtube-search(호출당 100유닛)를 태우지 않고 바로 재생함 — 아낀 쿼터로 재생 검색을
      // 더 여유 있게 쓸 수 있음.
      const videoId = track.videoId ?? (await searchYoutubeVideo(track.artist, track.name)).videoId;
      if (videoId) {
        setNowPlaying({ videoId, name: track.name, artist: track.artist, image: track.image ?? null });
        if (options?.manualNext !== undefined) {
          // 재생목록에서 고른 곡들을 순서대로 재생 중 — 큐를 비슷한 곡으로 덮어쓰지 않고
          // 남은 목록을 그대로 "다음 트랙" 패널에 반영함.
          isManualQueueRef.current = true;
          setQueue(options.manualNext);
        } else {
          // 평소처럼 카드/검색 결과를 직접 눌러서 재생한 경우 — 수동 큐 모드는 해제하고
          // "다음 트랙" 큐를 지금 재생 시작한 곡 기준으로 다시 채움 (비슷한 곡 라디오 방식).
          isManualQueueRef.current = false;
          repeatListRef.current = null;
          refreshQueue(track.artist, track.name, { append: options?.fromQueue ?? false });
        }
      } else {
        setError(`"${track.name}"의 재생 가능한 영상을 못 찾았어요.`);
      }
    } catch (err) {
      setError("재생 정보를 불러오지 못했어요. 백엔드에 YOUTUBE_API_KEY가 설정돼 있는지 확인해주세요.");
    }
  }

  // (§47, §48) append=false(기본값)면 예전처럼 큐를 완전히 새로 채움 — 검색/차트/즐겨찾기 등
  // 큐 바깥에서 새 곡을 골랐을 때. append=true는 "같은 라디오 세션이 이어지는 중"일 때만
  // (자동 이어재생, 또는 큐 안의 곡을 직접 클릭) 쓰여서, 기존 큐에서 방금 재생 시작한 곡만
  // 걷어내고 나머지는 그대로 둔 채 새 추천을 뒤에 이어붙임.
  //
  // append=true를 무조건 쓰지 않은 이유(§48): 처음엔 "다음 트랙 눌렀더니 후보가 다 사라진다"는
  // 피드백으로 무조건 이어붙이게 했었는데, 그러면 예를 들어 빅뱅 노래를 듣다가 검색으로 완전히
  // 다른 발라드를 틀어도 예전 빅뱅 계열 후보들이 큐에 계속 남아있어서 "장르가 하나도 안 맞는
  // 곡들이 섞여 나온다"는 문제가 생김 — 라이브 확인 중 발견. append는 "지금 큐에 이미 떠 있던
  // 후보 중 하나를 골라 이어듣는" 경우로만 좁혀야 장르 일관성이 유지됨.
  function refreshQueue(artist: string, name: string, options?: { append?: boolean }) {
    const append = options?.append ?? false;
    const trackKey = (t: { artist: string; name: string }) =>
      `${t.artist.toLowerCase().trim()}::${t.name.toLowerCase().trim()}`;
    const playedKey = trackKey({ artist, name });

    getSimilarTracks(artist, name)
      .then((data) => {
        if (!append) {
          setQueue(data.tracks);
          return;
        }
        setQueue((prev) => {
          const remaining = prev.filter((t) => trackKey(t) !== playedKey);
          const seen = new Set(remaining.map(trackKey));
          const merged = [...remaining];
          for (const t of data.tracks) {
            const key = trackKey(t);
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(t);
          }
          return merged.slice(0, MAX_QUEUE_SIZE);
        });
      })
      .catch(() => {
        // append 모드가 아닐 때(=완전히 새 곡으로 전환)만 비움 — append 모드에서 API 하나
        // 실패했다고 이미 떠 있던 후보까지 지울 이유는 없음.
        if (!append) setQueue([]);
      });
  }

  // 곡이 끝까지 재생됐을 때(MiniPlayer의 YT.PlayerState.ENDED) 호출됨.
  // 평소엔 큐의 맨 앞 곡으로 자동 이어재생(handlePlay가 그 곡 기준으로 큐도 같이 새로 채움).
  // 재생목록 "이어재생/반복재생" 중일 땐(isManualQueueRef) 그 대신 고른 목록을 그대로 소비하고,
  // 반복재생이면 다 소진했을 때 처음으로 돌아가며, 반복이 아니면 다 소진한 뒤 평소 라디오 방식으로
  // 자연스럽게 돌아감.
  // (§73 후속) nativeOverride는 안드로이드에서 화면이 꺼져 이 화면의 JS가 못 도는 동안
  // 헤드리스 웹뷰가 스스로 다음 곡으로 넘어갔을 때(onNativeAutoAdvance)만 넘어옴 — 실제로
  // 지금 재생 중인 곡의 videoId/제목/아티스트로 확실히 덮어써서, 혹시 모를 큐 상태 불일치가
  // 있어도 화면에 보이는 정보가 실제 재생과 어긋나지 않게 함(이미지 등 나머지 필드는 로컬
  // 큐에 있던 값을 그대로 재사용).
  function handleTrackEnded(nativeOverride?: { videoId: string; name: string; artist: string }) {
    function withOverride(base: Track | undefined): Track | undefined {
      if (!nativeOverride) return base;
      return {
        ...(base ?? { listeners: null, url: "", image: null }),
        videoId: nativeOverride.videoId,
        name: nativeOverride.name,
        artist: nativeOverride.artist,
      };
    }
    if (isManualQueueRef.current) {
      const next = withOverride(queue[0]);
      if (next) {
        handlePlay(next, { manualNext: queue.slice(1) });
        return;
      }
      if (repeatListRef.current && repeatListRef.current.length > 0) {
        const list = repeatListRef.current;
        const first = withOverride(list[0]);
        if (first) {
          handlePlay(first, { manualNext: list.slice(1) });
          return;
        }
      }
      isManualQueueRef.current = false;
      if (nowPlaying) refreshQueue(nowPlaying.artist, nowPlaying.name);
      return;
    }
    const next = withOverride(queue[0]);
    if (next) {
      handlePlay(next, { fromQueue: true });
    }
  }

  // 재생목록 상세 화면에서 체크한 곡들을 "이어재생"(repeat=false) 또는 "반복재생"(repeat=true)으로
  // 재생 — 멜론 재생목록 화면의 하단 액션바를 참고해서 추가. 다운로드/믹스업은 우리 서비스 특성상
  // (오디오 파일 없음/AI 믹스 서비스 없음) 그대로 구현이 어려워 제외하고 실제로 의미 있는 이 두 개만 구현.
  function handlePlaySelectedPlaylistTracks(selected: PlaylistTrack[], repeat: boolean) {
    if (selected.length === 0) return;
    const asTracks: Track[] = selected.map((t) => ({
      name: t.trackName,
      artist: t.artistName,
      listeners: null,
      url: t.url ?? "",
      image: t.imageUrl,
    }));
    repeatListRef.current = repeat ? asTracks : null;
    const [first, ...rest] = asTracks;
    handlePlay(first, { manualNext: rest });
    // 재생이 시작되면 상세 화면을 닫아서 하단 미니 플레이어가 바로 보이게 함.
    setOpenPlaylistId(null);
  }

  // 재생 버튼을 누른 시점이 아니라, MiniPlayer 안 유튜브 플레이어가 실제로 PLAYING 상태에 들어간
  // 순간(=진짜로 소리가 나기 시작한 순간)에 호출됨 — "재생 의도" 신호를 클릭 시점보다 한 단계 더
  // 정확하게(검색 실패로 아예 못 튼 경우는 신호로 안 남게) 잡기 위해 이 시점으로 옮김.
  function handleActuallyPlaying(track: { name: string; artist: string; image?: string | null }) {
    const existing = favoriteTracks.find(
      (f) => f.artistName === track.artist && f.trackName === track.name
    );
    if (existing) {
      markFavoriteTrackOpened(existing.id).catch(() => {});
    }

    // (§49) "다시 듣기" 홈 섹션용 최근 재생 기록. 즐겨찾기 여부와 무관하게 재생을 시작한
    // 모든 곡을 기록 — 화면에는 즉시 반영(맨 앞으로, 중복 제거)하고 서버 기록은 백그라운드로.
    setRecentPlays((prev) => [
      { name: track.name, artist: track.artist, listeners: null, url: "", image: track.image ?? null },
      ...prev.filter((t) => !(t.artist === track.artist && t.name === track.name)),
    ]);
    recordRecentPlay(track.artist, track.name, undefined, track.image ?? undefined).catch(() => {});
  }

  const selectedMoodLabel = MOODS.find((m) => m.tag === selectedMood)?.label;

  // (§49) "다시 듣기" 메인 화면 섹션용 — 원래 즐겨찾기(favoriteTracks)를 그대로 보여줬는데,
  // "사이드바 즐겨찾기랑 똑같은 걸 또 보여주면 중복 아니냐"는 지적으로 진짜 최근 재생
  // 기록(recentPlays)으로 교체함. 사이드바 즐겨찾기 목록(FavoriteTrackRow)은 이 변수를 안 쓰고
  // favoriteTracks를 직접 쓰므로 영향 없음. recentPlays는 이미 Track 형태라 별도 변환 없이 씀.
  const recentPlaysAsTrack: Track[] = recentPlays.map((t) => ({ ...t, url: t.url || "" }));

  // (모바일 헤더 개편) 왼쪽 사이드바("내 즐겨찾기 (아티스트)") 내용 — 데스크톱 <aside>와
  // 모바일 보관함 서랍이 완전히 같은 마크업/핸들러를 씀. closeAfterSelect는 모바일
  // 서랍에서만 true로 넘겨서, 아티스트를 고르면 서랍을 자동으로 닫아줌(데스크톱은 애초에
  // 서랍이 없으니 그냥 무시됨).
  function renderFavoriteArtists(closeAfterSelect = false) {
    if (favorites.length === 0) return null;
    return (
      <>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/40">
          내 즐겨찾기 (아티스트)
        </h2>
        <div className="flex flex-col gap-2">
          {favorites.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                handleSelectArtist(f.artistName);
                if (closeAfterSelect) setIsLibraryOpen(false);
              }}
              className="w-full rounded-full border border-white/10 bg-white/5 px-3 py-1 text-left text-xs hover:border-white/30"
            >
              ★ {f.artistName}
            </button>
          ))}
        </div>
      </>
    );
  }

  // (모바일 헤더 개편) 오른쪽 사이드바("다시 듣기" 즐겨찾기 곡 + "내 재생목록") 내용 — 위와
  // 같은 이유로 데스크톱/모바일 공용 함수로 뺌.
  function renderLibraryPanel(closeAfterSelect = false) {
    return (
      <>
        {favoriteTracks.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setIsFavoriteTracksExpanded((v) => !v)}
                className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-semibold uppercase tracking-wide text-white/40 hover:text-white/70"
              >
                <span className="shrink-0">{isFavoriteTracksExpanded ? "▾" : "▸"}</span>
                <span className="truncate">
                  즐겨찾기{" "}
                  <span className="normal-case text-white/30">{favoriteTracks.length}</span>
                </span>
              </button>
            </div>
            {isFavoriteTracksExpanded && (
              <div className="flex max-h-72 flex-col gap-1 overflow-y-auto pr-1">
                {favoriteTracks.map((t) => (
                  <FavoriteTrackRow
                    key={t.id}
                    track={t}
                    onPlay={handlePlay}
                    onToggleFavorite={handleToggleFavoriteTrack}
                    onAddToPlaylist={handleOpenAddToPlaylist}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-white/40">
              내 재생목록
            </h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleGenerateAutoPlaylists}
                disabled={isGeneratingPlaylists}
                aria-label="취향 분석해서 자동 생성"
                title="즐겨찾기한 곡을 장르별로 분석해서 자동으로 재생목록을 만들어요"
                className="rounded-full px-1.5 py-0.5 text-sm text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                {isGeneratingPlaylists ? "…" : "✨"}
              </button>
              <button
                type="button"
                onClick={() => setIsCreatingPlaylist((v) => !v)}
                aria-label="새 재생목록 직접 만들기"
                title="새 재생목록 직접 만들기"
                className="rounded-full px-1.5 py-0.5 text-sm text-white/50 hover:bg-white/10 hover:text-white"
              >
                ＋
              </button>
              {/* "정리하기"(안 들은 즐겨찾기 곡 정리)를 원래 "즐겨찾기" 섹션 헤더 안에 뒀는데,
                  그 섹션 자체가 즐겨찾기 곡이 하나도 없으면 통째로 안 보여서(§위 조건부 렌더링)
                  기능이 아예 사라진 것처럼 보인다는 피드백 — 항상 보이는 "내 재생목록" 줄로
                  옮겨서 즐겨찾기 개수와 무관하게 항상 접근 가능하게 함 */}
              <button
                type="button"
                onClick={handleOpenCleanup}
                disabled={isLoadingStale}
                aria-label="안 들은 곡 정리"
                title={`최근 ${STALE_MONTHS}개월간 안 들은 곡 정리하기`}
                className="rounded-full px-1.5 py-0.5 text-[11px] text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                {isLoadingStale ? "…" : "정리"}
              </button>
            </div>
          </div>

          {isCreatingPlaylist && (
            <div className="mb-2 flex gap-1">
              <input
                autoFocus
                value={newPlaylistName}
                onChange={(e) => setNewPlaylistName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreatePlaylistSubmit();
                  if (e.key === "Escape") setIsCreatingPlaylist(false);
                }}
                placeholder="재생목록 이름"
                className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={handleCreatePlaylistSubmit}
                className="shrink-0 rounded-md bg-accent px-2 py-1 text-xs text-black"
              >
                추가
              </button>
            </div>
          )}

          {playlists.length === 0 && !isCreatingPlaylist ? (
            <p className="text-xs text-white/30">
              아직 만든 재생목록이 없어요. ✨ 버튼으로 즐겨찾기한 곡을 분석해서 자동으로 만들거나,
              ＋ 버튼으로 직접 만들 수 있어요.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {playlists.map((playlist) => (
                <div key={playlist.id} className="flex items-center gap-1">
                  {/* 이름을 누르면(예전처럼 사이드바 안에서 펼치는 대신) 멜론 스타일
                      전체화면 상세 화면이 뜸 — 체크박스+이어재생/반복재생/담기/삭제는
                      좁은 사이드바보다 큰 화면에서 다루는 게 자연스러워서 옮김. */}
                  <button
                    type="button"
                    onClick={() => {
                      openPlaylistDetail(playlist.id);
                      if (closeAfterSelect) setIsLibraryOpen(false);
                    }}
                    className="flex min-w-0 flex-1 items-center justify-between gap-1 rounded-md px-1.5 py-1 text-left text-xs font-medium text-white/60 hover:bg-white/5 hover:text-white/90"
                  >
                    <span className="truncate">
                      {playlist.isAutoGenerated && "✨ "}
                      {playlist.name} <span className="text-white/30">{playlist.trackCount}</span>
                    </span>
                    {/* "여기가 눌리는 건지 모르겠다"는 피드백으로 추가한 화살표 — 즐겨찾기 아티스트
                        목록(★ 태그)처럼 테두리 있는 알약 버튼이 아니라 그냥 텍스트라 클릭 가능한
                        요소로 안 보였던 게 원인 — 명확한 클릭 힌트를 붙임. */}
                    <span className="shrink-0 text-white/30">›</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeletePlaylist(playlist.id)}
                    aria-label="재생목록 삭제"
                    className="shrink-0 rounded-full px-1 py-0.5 text-xs text-white/30 hover:bg-white/10 hover:text-white"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      {/* 상단 고정 헤더 — 멜론/유튜브 뮤직처럼 로고 + 검색창을 맨 위에 나란히 둠.
          기존엔 로고가 화면 중앙에 크게 있고 검색창은 본문 중간에 묻혀 있었는데,
          실제 음악 서비스들은 다 검색을 최상단에 상시 노출한다는 본인 피드백 반영. */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-black/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3 lg:grid lg:grid-cols-[200px_1fr_200px]">
          {/* 로고: b의 둥근 부분을 레코드판(그루브+센터홀)으로 만든 마크.
              브랜드 메인 색(코랄레드 #ff3b5c, 기존 강조색을 그대로 재사용)을
              처음으로 실제 로고에 쓰는 자리라 Unbeat 글자 옆에 둠 */}
          <div className="flex items-center gap-2">
            <svg width="28" height="28" viewBox="0 0 36 36" aria-hidden="true" className="shrink-0">
              <rect x="9" y="6" width="4.6" height="24" rx="2.3" fill="#ff3b5c" />
              <circle cx="19.5" cy="22" r="8.4" fill="#ff3b5c" />
              <circle cx="19.5" cy="22" r="5.8" fill="none" stroke="#0a0a0a" strokeWidth="1.5" />
              <circle cx="19.5" cy="22" r="3.2" fill="none" stroke="#0a0a0a" strokeWidth="1.3" />
              <circle cx="19.5" cy="22" r="1.1" fill="#0a0a0a" />
            </svg>
            <h1 className="text-lg font-bold">Unbeat</h1>
          </div>
          <div className="flex items-center justify-end gap-1 lg:justify-center">
            <SearchBar
              onSearch={handleSearch}
              isLoading={isSearching}
              recentSearches={recentSearches}
              onRemoveRecent={handleRemoveRecent}
            />
            {/* (모바일 헤더 개편) "보관함" 아이콘 — 즐겨찾기 아티스트/즐겨찾기 곡/재생목록은
                데스크톱에선 좌우 사이드바로 항상 보이는데, 폰 화면(sm 미만)에선 그 사이드바가
                아예 안 보여서(hidden lg:block) 이 세 기능을 볼 방법이 없었음. 눌렀을 때
                아래 전체화면 서랍으로 같은 내용을 보여줌. */}
            <button
              type="button"
              aria-label="보관함"
              onClick={() => setIsLibraryOpen(true)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/80 hover:bg-white/10 sm:hidden"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <path d="M19 21V8a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v13l7-4 7 4Z" />
              </svg>
            </button>
          </div>
          {/* 오른쪽 칸은 지금은 비워둠 — 본문 쪽 오른쪽 사이드바랑 폭을 맞추기 위한 자리 */}
          <div className="hidden lg:block" />
        </div>
      </header>

      {/* 모바일 "보관함" 전체화면 서랍 — 즐겨찾기 아티스트/즐겨찾기 곡/내 재생목록을 데스크톱
          사이드바와 완전히 같은 내용(renderFavoriteArtists/renderLibraryPanel)으로 보여줌. */}
      {isLibraryOpen && (
        <div className="fixed inset-0 z-50 flex h-screen w-screen flex-col bg-black sm:hidden">
          <div className="flex items-center gap-2 border-b border-white/10 p-3">
            <button
              type="button"
              aria-label="보관함 닫기"
              onClick={() => setIsLibraryOpen(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/80 hover:bg-white/10"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <h2 className="text-base font-semibold">보관함</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex flex-col gap-8">
              {favorites.length > 0 && <div>{renderFavoriteArtists(true)}</div>}
              {renderLibraryPanel(true)}
            </div>
          </div>
        </div>
      )}

    <main
      className={`mx-auto grid min-h-screen max-w-6xl grid-cols-1 gap-6 px-6 pb-10 pt-7 lg:grid-cols-[200px_1fr_200px] ${
        nowPlaying ? "pb-40 sm:pb-28" : ""
      }`}
    >
      {/* 데스크톱 3열 그리드에서 왼쪽 사이드바가 실제로 왼쪽에 오도록 order를 명시.
          JSX 선언 순서는 (중앙 → 왼쪽 사이드 → 오른쪽 사이드)라 order 없이는 중앙이 첫 칸(200px)에 끼임. */}
      <div className="flex flex-col items-center gap-8 lg:order-2">
      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* 검색 없이 바로 탐색하는 흐름 — 유튜브 뮤직 홈처럼 검색창 바로 아래에 무드 칩부터 노출.
          예전엔 이 블록이 차트/인기 아티스트 밑에 깔려있어서 스크롤을 많이 해야 보였는데,
          "검색창 바로 밑으로 올려달라"는 피드백을 받고 맨 위로 옮김. */}
      <div className="w-full max-w-xl">
        {/* "무드" 같은 라벨 텍스트 없이 칩만 바로 노출 — 유튜브 뮤직 등도 이 UI 자체가
            익숙해서 별도 설명 없이 바로 알아본다는 피드백으로 제목 줄 자체를 없앰 */}
        <MoodChips selectedTag={selectedMood} onSelect={handleSelectMood} />
      </div>

      {/* "빠른 선곡" — 원래 "인기 있는 곡(글로벌)"/"다시 듣기" 밑, 스크롤을 몇 번 내려야 나오는
          자리에 있었음. "폰으로 처음 들어가면 무드 칩 밑으로 화면이 비어 보인다"는 피드백으로
          검색창/무드 칩 바로 아래로 끌어올림 — 즐겨찾기가 없는 첫 방문자도 chartTracks 폴백으로
          곧바로 곡이 채워진다(§아래 useEffect 참고). "인기 있는 곡(글로벌)"은 실제 차트라
          새로고침해도 고정돼야 맞는데 "유튜브 뮤직처럼 매번 좀 달라졌으면 좋겠다"는 피드백을 받아
          따로 둔 섹션. 처음엔 즐겨찾기 태그/아티스트 기반 셔플이었는데([[학습노트 37번]]), 이후
          실제 Claude Haiku 4.5 LLM 추천으로 교체함([[학습노트 38번]], 실패 시에만 셔플로 폴백). */}
      {quickPickTracks.length > 0 && (
        <div className="w-full max-w-xl">
          <p className="mb-2 text-xs text-white/40">빠른 선곡</p>
          <CompactTrackGrid
            tracks={quickPickTracks}
            isFavorite={isTrackFavorite}
            onToggleFavorite={handleToggleFavoriteTrack}
            onPlay={handlePlay}
            onAddToPlaylist={handleOpenAddToPlaylist}
            scrollable
          />
        </div>
      )}

      {isLoadingMood && <p className="text-sm text-white/50">곡 불러오는 중...</p>}

      {/* 국내/해외 구분해서 보여달라는 피드백 — Last.fm 무드 태그가 서구 팝 위주라
          한 목록에 다 섞으면 팝송만 보이는 문제가 있었음. 국내 곡이 있으면 먼저,
          해외 곡을 그 아래 별도 섹션으로 보여줌(유튜브 뮤직의 여러 믹스 행을 참고). */}
      {selectedMood && !isLoadingMood && (
        <div className="w-full max-w-xl">
          {domesticMoodTracks.length === 0 && internationalMoodTracks.length === 0 ? (
            <p className="text-sm text-white/50">이 무드에 맞는 곡을 못 찾았어요.</p>
          ) : (
            <>
              {domesticMoodTracks.length > 0 && (
                <div className="mb-6">
                  <p className="mb-2 text-xs text-white/40">"{selectedMoodLabel}" 국내 인기곡</p>
                  <CompactTrackGrid
                    tracks={domesticMoodTracks}
                    isFavorite={isTrackFavorite}
                    onToggleFavorite={handleToggleFavoriteTrack}
                    onPlay={handlePlay}
                    onAddToPlaylist={handleOpenAddToPlaylist}
                    scrollable
                  />
                </div>
              )}
              {internationalMoodTracks.length > 0 && (
                <div>
                  <p className="mb-2 text-xs text-white/40">"{selectedMoodLabel}" 해외 인기곡</p>
                  <CompactTrackGrid
                    tracks={internationalMoodTracks}
                    isFavorite={isTrackFavorite}
                    onToggleFavorite={handleToggleFavoriteTrack}
                    onPlay={handlePlay}
                    onAddToPlaylist={handleOpenAddToPlaylist}
                    scrollable
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {searchTracks.length > 0 && (
        <div className="w-full max-w-xl">
          <p className="mb-2 text-xs text-white/40">
            검색된 곡
            {aiGuessedQuery && (
              <span className="ml-1 text-white/30">
                (AI 추측: <span className="text-white/50">{aiGuessedQuery}</span>로 검색됨)
              </span>
            )}
            {youtubeFallbackUsed && (
              <span className="ml-1 text-white/30">
                (Last.fm에 없어서 유튜브에서 찾았어요 · 첫 곡은 청취자 수 등 정보 없음)
              </span>
            )}
          </p>
          <TrackList
            tracks={searchTracks}
            isFavorite={isTrackFavorite}
            onToggleFavorite={handleToggleFavoriteTrack}
            onPlay={handlePlay}
            onAddToPlaylist={handleOpenAddToPlaylist}
          />
        </div>
      )}

      {/* "2010년대 kpop"처럼 아티스트/곡 이름이 아니라 장르·연대 키워드로 검색했을 때 백엔드가
          Last.fm 태그로 보완해서 내려주는 목록 — 정확한 검색 결과가 아니라 "관련 곡"이라는 걸
          제목으로 구분해서 보여줌. 카드보다 촘촘한 줄 스타일(CompactTrackGrid, 무드 탐색과 동일)로 표시. */}
      {tagSearchTracks.length > 0 && (
        <div className="w-full max-w-xl">
          <p className="mb-2 text-xs text-white/40">관련 곡 (장르/연대)</p>
          <CompactTrackGrid
            tracks={tagSearchTracks}
            isFavorite={isTrackFavorite}
            onToggleFavorite={handleToggleFavoriteTrack}
            onPlay={handlePlay}
            onAddToPlaylist={handleOpenAddToPlaylist}
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
            {!correctedArtistName && aiGuessedQuery && (
              <span className="ml-1 text-white/30">
                (AI 추측: <span className="text-white/50">{aiGuessedQuery}</span>로 검색됨)
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
            onPlay={handlePlay}
            onAddToPlaylist={handleOpenAddToPlaylist}
          />
        </div>
      )}

      {/* (§61) 검색 중엔 검색과 무관한 글로벌 차트 대신, 검색한 아티스트의 다른 곡으로 채움 —
          "검색해도 검색된 곡 빼고는 다 똑같다, 유튜브 뮤직처럼 검색과 관련된 곡이 홈에도 떴으면
          좋겠다"는 요청 반영. /recommend(비슷한 아티스트)와 달리 이 아티스트 "본인"의 곡만 씀. */}
      {searchContextArtist && searchArtistTracks.length > 0 && (
        <div className="w-full max-w-xl">
          <p className="mb-2 text-xs text-white/40">"{searchContextArtist}"의 다른 곡</p>
          <TrackList
            tracks={searchArtistTracks}
            isFavorite={isTrackFavorite}
            onToggleFavorite={handleToggleFavoriteTrack}
            onPlay={handlePlay}
            onAddToPlaylist={handleOpenAddToPlaylist}
          />
        </div>
      )}

      {/* 검색/무드 선택 전 기본 화면 — 멜론(인기있어요)/유튜브 뮤직(맞춤 믹스)/스포티파이(인기 상승 곡·
          인기 아티스트)처럼 아무 조작 없이도 여러 행으로 콘텐츠가 채워져 있어야 한다는 피드백 반영.
          한 덩어리였던 "지금 인기 있는 곡"을 글로벌 차트/국내 차트/인기 아티스트 세 행으로 나눔.
          (§61) 검색 중(searchContextArtist가 있을 때)엔 위 섹션으로 대체되므로 숨김. */}
      {!searchContextArtist && chartTracks.length > 0 && (
        <div className="w-full max-w-xl">
          <p className="mb-2 text-xs text-white/40">지금 인기 있는 곡 (글로벌)</p>
          <TrackList
            tracks={chartTracks}
            isFavorite={isTrackFavorite}
            onToggleFavorite={handleToggleFavoriteTrack}
            onPlay={handlePlay}
            onAddToPlaylist={handleOpenAddToPlaylist}
          />
        </div>
      )}

      {/* (§49) "다시 듣기" — 원래 사이드바 즐겨찾기 목록을 홈 화면 메인에도 그대로 노출했었는데,
          "사이드바 즐겨찾기랑 똑같은 걸 다시 듣기에도 보여주면 중복 아니냐"는 지적을 받고
          진짜 "최근에 재생한 곡" 기록(recentPlays)으로 데이터 소스를 바꿈 — 이제 사이드바
          "즐겨찾기"(별표한 곡, 즐겨찾기 시점순)와 여기 "다시 듣기"(재생 시작 시점순)는 서로
          다른 기준의 서로 다른 목록이라 중복이 아님. */}
      {recentPlaysAsTrack.length > 0 && (
        <div className="w-full max-w-xl">
          <p className="mb-2 text-xs text-white/40">다시 듣기</p>
          <CompactTrackGrid
            tracks={recentPlaysAsTrack}
            isFavorite={isTrackFavorite}
            onToggleFavorite={handleToggleFavoriteTrack}
            onPlay={handlePlay}
            onAddToPlaylist={handleOpenAddToPlaylist}
            scrollable
          />
        </div>
      )}

      {/* "국내 인기 차트"는 원래 Last.fm geo.getTopTracks였는데, "유튜브 API를 연동해놓고
          왜 재생 검색에만 쓰냐"는 피드백으로 실제 유튜브 트렌딩(videos.list) 기반으로 교체 —
          국내/해외를 이름으로 추측하지 않고 regionCode로 정확히 나눔. 짝을 이루는 해외
          섹션도 같은 API를 US 리전으로 호출해서 새로 추가함. */}
      {krChartTracks.length > 0 && (
        <div className="w-full max-w-xl">
          <p className="mb-2 text-xs text-white/40">국내 인기 급상승</p>
          <TrackList
            tracks={krChartTracks}
            isFavorite={isTrackFavorite}
            onToggleFavorite={handleToggleFavoriteTrack}
            onPlay={handlePlay}
            onAddToPlaylist={handleOpenAddToPlaylist}
          />
        </div>
      )}

      {usTrendingTracks.length > 0 && (
        <div className="w-full max-w-xl">
          <p className="mb-2 text-xs text-white/40">해외 인기 급상승</p>
          <TrackList
            tracks={usTrendingTracks}
            isFavorite={isTrackFavorite}
            onToggleFavorite={handleToggleFavoriteTrack}
            onPlay={handlePlay}
            onAddToPlaylist={handleOpenAddToPlaylist}
          />
        </div>
      )}

      {/* (§61) 검색 중엔 위 "본인 다른 곡" 섹션으로 대체되므로 숨김 — 검색과 무관한 인기
          아티스트 랭킹을 계속 보여주면 "검색해도 다 똑같다"는 원래 지적이 그대로 남기 때문. */}
      {!searchContextArtist && topArtists.length > 0 && (
        <div className="w-full max-w-xl">
          <p className="mb-2 text-xs text-white/40">인기 아티스트</p>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {topArtists.map((artist) => (
              <div key={artist.name} className="w-64 shrink-0">
                <ArtistCard
                  artist={artist}
                  isSelected={selectedArtist === artist.name}
                  isFavorite={favorites.some((f) => f.artistName === artist.name)}
                  onSelect={handleSelectArtist}
                  onToggleFavorite={handleToggleFavorite}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      </div>

      {/* 왼쪽 사이드바: 내 즐겨찾기(아티스트) — 가운데는 눈에 띄는 기본 콘텐츠(차트/무드)에 집중시키고
          즐겨찾기류는 옆으로 뺌 (유튜브 뮤직/멜론도 즐겨찾기·라이브러리는 사이드에 둠). */}
      <aside className="hidden lg:order-1 lg:block">
        <div className="sticky top-16">{renderFavoriteArtists()}</div>
      </aside>

      {/* 오른쪽 사이드바: 즐겨찾기한 곡 "다시 듣기"(플랫 목록) + 직접 만드는 "내 재생목록".
          한 번은 Last.fm 원본 태그(K-POP/IU/KOREAN)로, 또 한 번은 무드 어휘로 자동 그룹핑을
          시도했다가 둘 다 "내가 원하는 건 자동 분류가 아니라 유튜브처럼 내가 직접 이름 짓고
          곡을 담는 재생목록"이라는 명확한 피드백을 받고 방향을 바꿈. 재생목록은 즐겨찾기(별표)와
          별개 도메인(플레이리스트-service의 Playlist/PlaylistTrack)이라 곡 하나가 여러
          재생목록에 동시에 들어갈 수 있음. */}
      <aside className="hidden lg:order-3 lg:block">
        <div className="sticky top-16 flex flex-col gap-6">{renderLibraryPanel()}</div>
      </aside>
    </main>

    {/* 하단 고정 미니 플레이어 — Last.fm 페이지로도, 눈에 보이는 유튜브 iframe으로도 안 나가고
        Unbeat 자체 UI로 재생/일시정지/진행바를 직접 그림 (MiniPlayer 내부에서 처리) */}
    {nowPlaying && (
      <MiniPlayer
        track={nowPlaying}
        onClose={() => setNowPlaying(null)}
        onActuallyPlaying={() => handleActuallyPlaying(nowPlaying)}
        onEnded={() => handleTrackEnded()}
        onNativeAutoAdvance={(data) =>
          handleTrackEnded({ videoId: data.videoId, name: data.title, artist: data.artist })
        }
        queue={queue}
        onSelectQueueTrack={(t) => handlePlay(t, { fromQueue: true })}
        onSaveQueueToPlaylist={(tracks) =>
          handleOpenBulkAddToPlaylist(tracks.map((t) => ({ name: t.name, artist: t.artist, image: t.image })))
        }
        isFavorite={isTrackFavorite({
          name: nowPlaying.name,
          artist: nowPlaying.artist,
          listeners: null,
          url: "",
          image: nowPlaying.image,
        })}
        onToggleFavorite={() =>
          handleToggleFavoriteTrack({
            name: nowPlaying.name,
            artist: nowPlaying.artist,
            listeners: null,
            url: "",
            image: nowPlaying.image,
          })
        }
      />
    )}

    {/* 트랙 카드/즐겨찾기 목록의 ＋ 버튼(1곡), 또는 재생목록 상세 화면의 "담기"(여러 곡)를
        누르면 뜨는 "재생목록에 추가" 모달 */}
    {addToPlaylistTracks && addToPlaylistTracks.length > 0 && (
      <AddToPlaylistModal
        tracks={addToPlaylistTracks}
        playlists={playlists}
        onClose={() => setAddToPlaylistTracks(null)}
        onAddToPlaylist={handleAddTracksToPlaylist}
        onCreatePlaylist={handleCreatePlaylistAndAddTrack}
      />
    )}

    {/* 재생목록 이름을 누르면 뜨는 멜론 스타일 전체화면 상세 화면 —
        체크박스로 곡을 고르고 하단 액션바(이어재생/반복재생/담기/삭제)로 일괄 처리 */}
    {openPlaylistId !== null &&
      (() => {
        const playlist = playlists.find((p) => p.id === openPlaylistId);
        if (!playlist) return null;
        return (
          <PlaylistDetailOverlay
            playlist={playlist}
            tracks={playlistTracksById[openPlaylistId]}
            onClose={() => setOpenPlaylistId(null)}
            onPlayTrack={(t) => {
              // 재생목록 상세 화면(z-40)이 하단 미니 플레이어(z-30)를 통째로 가리고 있어서,
              // 곡을 눌러 실제로 재생이 시작돼도 화면엔 아무 변화가 없어 보이는 문제가 있었음
              // — "이어재생"/"반복재생"처럼 재생 시작 시 화면을 닫아서 미니 플레이어가 바로
              // 보이게 함(하단 액션바 재생들과 동작을 통일).
              handlePlay(t);
              setOpenPlaylistId(null);
            }}
            onPlaySelected={handlePlaySelectedPlaylistTracks}
            onAddSelectedToPlaylist={(tracks) =>
              handleOpenBulkAddToPlaylist(
                tracks.map((t) => ({ name: t.trackName, artist: t.artistName, image: t.imageUrl }))
              )
            }
            onRemoveTrack={(trackId) => handleRemoveTracksFromPlaylist(openPlaylistId, [trackId])}
            onDeleteSelected={(trackIds) => handleRemoveTracksFromPlaylist(openPlaylistId, trackIds)}
          />
        );
      })()}

    {isCleanupOpen && (
      <StaleTracksModal
        tracks={staleTracks}
        months={STALE_MONTHS}
        onClose={() => setIsCleanupOpen(false)}
        onDeleteSelected={handleDeleteStaleTracks}
      />
    )}
    </>
  );
}
