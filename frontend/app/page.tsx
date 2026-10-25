"use client";

import { useEffect, useRef, useState } from "react";
import SearchBar, { type SearchBarHandle, type RecentSearchEntry } from "@/components/SearchBar";
import ArtistCard from "@/components/ArtistCard";
import TrackList from "@/components/TrackList";
import CompactTrackGrid from "@/components/CompactTrackGrid";
import MoodChips, { MOODS } from "@/components/MoodChips";
import MiniPlayer, { type NowPlayingTrack } from "@/components/MiniPlayer";
import FavoriteTrackRow from "@/components/FavoriteTrackRow";
import AddToPlaylistModal from "@/components/AddToPlaylistModal";
import PlaylistDetailOverlay from "@/components/PlaylistDetailOverlay";
import StaleTracksModal from "@/components/StaleTracksModal";
import AuthModal from "@/components/AuthModal";
import RankingPage from "@/components/RankingPage";
import { supabase } from "@/lib/supabase";
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
  getContextMood,
  getDiaryReflection,
  type Artist,
  type Track,
  type ContextMoodResult,
  type DiaryReflectionResult,
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
  setPlaylistVisibility,
  getPublicPlaylists,
  setNickname,
  getProfile,
  likePlaylist,
  unlikePlaylist,
  PlaylistApiError,
  type Favorite,
  type FavoriteTrack,
  type Playlist,
  type PlaylistTrack,
  type PublicPlaylist,
} from "@/lib/playlistApi";
import { MUSIC_CATEGORIES } from "@/lib/categories";

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

// 무드 칩 결과 표시 방식 비교용: "sheet" = 하단 시트, "scroll" = 결과 위치로 자동 스크롤
const MOOD_RESULT_MODE: "sheet" | "scroll" = "scroll";

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
  const [searchingQuery, setSearchingQuery] = useState("");
  const swipeBackRef = useRef<{ x: number; y: number } | null>(null);
  // 공개 전환하려다 로그인이 필요해서 로그인 팝업을 띄운 재생목록 — 로그인 성공 후 이어서 공개 전환
  const resumePublishRef = useRef<Playlist | null>(null);
  const [isRecommending, setIsRecommending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [favoriteTracks, setFavoriteTracks] = useState<FavoriteTrack[]>([]);
  const [recentSearches, setRecentSearches] = useState<RecentSearchEntry[]>([]);
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
  // (Phase 5-3) 컨텍스트 인식 탐색 — GPS+실시간 날씨로 자동 추천되는 섹션. 버튼으로 가리지
  // 않고 홈 진입 시 자동으로 위치 권한을 물어보기로 결정(사용자 요청) — 거부/실패해도
  // 에러 UI 없이 그냥 섹션을 안 보여줌(조용히 무시).
  const [contextMood, setContextMood] = useState<ContextMoodResult | null>(null);
  const [domesticMoodTracks, setDomesticMoodTracks] = useState<Track[]>([]);
  const [internationalMoodTracks, setInternationalMoodTracks] = useState<Track[]>([]);
  const [isLoadingMood, setIsLoadingMood] = useState(false);

  // (Phase 5-3) 감정 다이어리 — 자유 텍스트 일기를 Claude Haiku가 읽고 공감 메시지 +
  // 어울리는 무드의 추천곡을 돌려줌. 서버는 일기 원문을 저장하지 않아서(프라이버시),
  // 기록은 이 브라우저의 localStorage에만 남김(즐겨찾기/플레이리스트와 같은 패턴) —
  // 로그인 여부와 무관하게 기기가 바뀌면 기록도 같이 사라지는 건 알려진 트레이드오프.
  const DIARY_HISTORY_KEY = "unbeat:diary-history";
  const DIARY_HISTORY_CAP = 10;
  type DiaryHistoryEntry = {
    date: string; // YYYY-MM-DD
    at?: string; // ISO 일시 — 시각 표시용(예전에 저장된 기록엔 없을 수 있음)
    text: string;
    message: string;
    moodLabel: string;
  };
  // (UI 재배치, 2026-10-08) 처음엔 홈 피드 안에 입력창을 바로 깔아놨는데, "스크롤로 곡 보는
  // 흐름 중간에 글 쓰는 칸이 끼어있는 게 안 어울린다"는 피드백으로, 홈에는 작은 진입 버튼만
  // 남기고 실제 입력/결과는 모달로 분리(AuthModal과 같은 "화면 중앙 모달" 패턴 재사용).
  const [isDiaryOpen, setIsDiaryOpen] = useState(false);
  const [diaryText, setDiaryText] = useState("");
  const [diaryResult, setDiaryResult] = useState<DiaryReflectionResult | null>(null);
  const [isDiaryLoading, setIsDiaryLoading] = useState(false);
  const [diaryError, setDiaryError] = useState<string | null>(null);
  const [diaryHistory, setDiaryHistory] = useState<DiaryHistoryEntry[]>([]);
  const [isDiaryHistoryOpen, setIsDiaryHistoryOpen] = useState(false);
  const DIARY_TEXT_MAX_LENGTH = 500;

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
  // "새로고침" 버튼이 올리면 아래 빠른 선곡 effect가 다시 돌아 추천을 새로 받음.
  const [quickPickRefreshKey, setQuickPickRefreshKey] = useState(0);

  // 하단 미니 플레이어 — 트랙 카드를 누르면 Last.fm 자체 페이지로 나가는 대신
  // 유튜브에서 이 곡을 찾아 사이트 안에서 바로 재생함 (우리는 자체 오디오 스트리밍 라이선스가 없어서
  // Last.fm으로 나가면 "그냥 Last.fm 따까리"처럼 느껴진다는 피드백을 받고 바꿈).
  // 유튜브 iframe 자체(로고/자막 버튼/재생바)를 그대로 보여주면 여전히 "남의 사이트를 빌려온 느낌"이라는
  // 추가 피드백을 받고, 재생/진행바 UI는 전부 MiniPlayer가 자체적으로 그림 — 여긴 videoId만 넘겨줌.
  const [nowPlaying, setNowPlaying] = useState<NowPlayingTrack | null>(null);
  // 이전곡 버튼용: 직전에 재생하던 곡들을 쌓아둠 (최대 30곡)
  const nowPlayingRef = useRef<NowPlayingTrack | null>(null);
  nowPlayingRef.current = nowPlaying;
  const playHistoryRef = useRef<NowPlayingTrack[]>([]);

  // (Task #44-3) "믹스" 시작 버튼 2개(하이라이트 믹스/전체 믹스) 전용 신호 — "빠른 선곡" 풀에서
  // 무작위 곡 하나를 골라 바로 재생 시작. MiniPlayer의 번개 토글 버튼(지금 재생 중인 곡 하나를
  // 대상으로 하이라이트 모드를 켜고 끄는 용도)과는 별개의 독립된 진입점으로 만들어달라는 요청 —
  // id를 매번 올려서 MiniPlayer에 내려주면, 그 안의 전용 effect가 반응해 하이라이트 모드를
  // 켜거나(highlight: true) 끔(false, 평소 전곡 재생).
  const mixRequestIdRef = useRef(0);
  const [mixRequest, setMixRequest] = useState<{ id: number; highlight: boolean } | null>(null);

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
  // (게이미피케이션 2단계, 2026-10-10) 공개/비공개 전환 + 다른 사람 재생목록 둘러보기 피드.
  // 처음엔 재생목록 상세 화면 안 🌐 아이콘+모달이었는데, "게이미피케이션 기능이 아이콘 하나로
  // 띡 나오니 이상하다"는 라이브 피드백으로 하단 탭바의 전용 탭 + 전체화면(RankingPage)으로
  // 옮김([[학습노트 90번]] 예정) — state 이름은 그대로 두되 역할은 "랭킹 페이지 열림 여부".
  const [isTogglingVisibility, setIsTogglingVisibility] = useState(false);
  const [isPublicFeedOpen, setIsPublicFeedOpen] = useState(false);
  const [publicPlaylists, setPublicPlaylists] = useState<PublicPlaylist[]>([]);
  const [isLoadingPublicFeed, setIsLoadingPublicFeed] = useState(false);
  // 피드에서 재생목록을 클릭하면 그 안의 곡 목록을 같은 모달 안에서 보여줌(상세 화면을 또
  // 새로 안 만들고, "둘러보기 목록 <-> 선택한 재생목록 곡" 두 단계만 모달 하나로 처리).
  const [viewingPublicPlaylistId, setViewingPublicPlaylistId] = useState<number | null>(null);
  const [publicPlaylistTracks, setPublicPlaylistTracks] = useState<PlaylistTrack[] | null>(null);
  // (게이미피케이션 2.5단계, 2026-10-10) "재생목록이 그냥 올라가기보단 닉네임을 정해서 그
  // 사람 페이지로 들어가는 식이면 좋겠다"는 피드백으로 추가 — 공개 피드에서 닉네임을 누르면
  // 그 사람이 공개한 재생목록 모음(프로필 페이지)으로 들어감.
  const [viewingProfileNickname, setViewingProfileNickname] = useState<string | null>(null);
  const [profilePlaylists, setProfilePlaylists] = useState<PublicPlaylist[] | null>(null);
  // 재생목록을 처음 공개로 전환하려는데 아직 닉네임이 없으면(백엔드 428) 닉네임 설정 모달을
  // 띄움 — 어느 재생목록을 공개하려던 시도였는지 기억해뒀다가, 닉네임 저장에 성공하면 그
  // 재생목록 공개 전환을 자동으로 다시 시도함(사용자가 "공개" 버튼을 두 번 누르지 않게).
  const [isNicknameModalOpen, setIsNicknameModalOpen] = useState(false);
  const [pendingVisibilityPlaylist, setPendingVisibilityPlaylist] = useState<Playlist | null>(null);
  const [nicknameInput, setNicknameInput] = useState("");
  const [nicknameError, setNicknameError] = useState<string | null>(null);
  const [isSavingNickname, setIsSavingNickname] = useState(false);
  // (랭킹 카테고리 필터, 2026-10-10 추가) 비공개 -> 공개 전환은 이제 카테고리를 먼저 골라야
  // 해서, 닉네임 모달과 같은 패턴으로 "공개하려던 재생목록"과 "그때 고른 카테고리"를
  // 기억해뒀다가 닉네임 모달까지 거쳐도(428) 마지막에 한 번에 handlePublish로 제출함.
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [pendingVisibilityCategory, setPendingVisibilityCategory] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  // (모바일 헤더 개편) 즐겨찾기 아티스트/즐겨찾기 곡/재생목록은 데스크톱에선 좌우 사이드바로
  // 항상 보이는데, 폰 화면(sm 미만)에선 그 사이드바 자체가 안 보여서(hidden lg:block) 이 세
  // 기능을 볼 방법이 아예 없었음. 헤더에 "보관함" 아이콘을 추가해서 눌렀을 때 이 내용을
  // 전체화면 서랍(drawer)으로 대신 보여줌 — 실제 데이터/핸들러는 아래 사이드바와 완전히
  // 공유(renderFavoriteArtists/renderLibraryPanel)해서 로직이 두 군데로 갈라지지 않게 함.
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  // 하단 탭바의 "검색" 탭이 SearchBar 내부의 모바일 전체화면 검색을 대신 열게 하기 위한 ref.
  // (state를 끌어올리지 않고 메서드만 노출 — SearchBar.tsx의 openMobileSearch 참고)
  const searchBarRef = useRef<SearchBarHandle>(null);
  // 로그인은 선택 기능(ROADMAP 5-2 결정) — null이면 비로그인 상태로 기존처럼 전부 동작.
  // 로그인했을 때만 헤더에 이메일/로그아웃 버튼이 뜨고, api.ts가 Authorization 헤더를 추가로 보냄.
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  // (버그 수정, 2026-10-08) 하단 탭바 "프로필"이 로그인 상태에서 눌렀을 때 아무 확인 화면
  // 없이 바로 signOut()을 호출해버려서, "로그인이 됐는지 안 됐는지 전혀 안 보인다"는 혼란을
  // 실제로 겪음 — 로그인됐을 때만 이메일+로그아웃 버튼이 있는 작은 바텀시트를 보여주도록 분리.
  const [isProfileSheetOpen, setIsProfileSheetOpen] = useState(false);
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

  // (게이미피케이션 2단계, 2.5단계에서 428 분기 추가, 카테고리 필터에서 공개 전환 분리)
  // 공개 -> 비공개는 카테고리가 필요 없으니 바로 API를 호출하지만, 비공개 -> 공개는 먼저
  // 카테고리를 골라야 해서(handlePublish가 실제 호출을 담당) 여기서는 카테고리 선택 모달만 띔.
  async function handleToggleVisibility(playlist: Playlist) {
    if (playlist.isPublic) {
      // 공개 -> 비공개: 카테고리 선택 불필요, 바로 전환.
      setIsTogglingVisibility(true);
      setError(null);
      try {
        const updated = await setPlaylistVisibility(playlist.id, false);
        setPlaylists((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      } catch {
        setError("재생목록 공개 설정을 바꾸지 못했어요.");
      } finally {
        setIsTogglingVisibility(false);
      }
      return;
    }
    // (버그 수정, 2026-10-22, 피드백 #2) 비로그인이면 카테고리부터 고르게 한 뒤 마지막에 403으로
    // 로그인 팝업이 뜨고, 로그인해도 공개가 이어지지 않아서 처음부터 다시 눌러야 했음(그때 또
    // 같은 팝업이 반복). 로그인이 필요하다는 걸 맨 앞에서 먼저 확인해서 로그인부터 시키고, 로그인에
    // 성공하면 원래 하려던 공개 전환(카테고리 선택)을 자동으로 이어서 띄움.
    if (supabase && !userEmail) {
      resumePublishRef.current = playlist;
      setIsAuthModalOpen(true);
      return;
    }
    // 비공개 -> 공개: 카테고리를 먼저 고르게 함 (닉네임과 같은 "그 순간에만 물어보기" 패턴).
    setPendingVisibilityPlaylist(playlist);
    setSelectedCategory(null);
    setIsCategoryModalOpen(true);
  }

  // (랭킹 카테고리 필터, 2026-10-10 추가) 카테고리 선택 모달에서 "선택하고 공개하기"를
  // 누르면 실제로 공개 전환 API를 호출함. 닉네임이 아직 없으면(428) 카테고리를 기억해두고
  // 닉네임 모달을 띄워서, 닉네임 저장 성공 시 이 함수를 다시 호출해 이어서 공개 전환함.
  async function handlePublish(playlist: Playlist, category: string) {
    setIsTogglingVisibility(true);
    setError(null);
    try {
      const updated = await setPlaylistVisibility(playlist.id, true, category);
      setPlaylists((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setIsCategoryModalOpen(false);
      setPendingVisibilityPlaylist(null);
      setPendingVisibilityCategory(null);
      setSelectedCategory(null);
    } catch (err) {
      const status = err instanceof PlaylistApiError ? err.status : null;
      if (status === 428) {
        // 닉네임 설정 모달에서 저장 성공 시 같은 카테고리로 공개 전환을 자동 재시도함
        // (handleSetNickname 참고) — 사용자가 카테고리를 다시 고르지 않아도 되게 기억해둠.
        setPendingVisibilityCategory(category);
        setIsCategoryModalOpen(false);
        setNicknameError(null);
        setIsNicknameModalOpen(true);
      } else if (status === 403) {
        // 세션이 만료됐거나 로그인이 풀린 경우 — 로그인 후 공개 전환을 이어서 하도록 기억해둠
        setIsCategoryModalOpen(false);
        resumePublishRef.current = playlist;
        setIsAuthModalOpen(true);
      } else {
        setError("재생목록 공개 설정을 바꾸지 못했어요.");
      }
    } finally {
      setIsTogglingVisibility(false);
    }
  }

  // (게이미피케이션 2.5단계, 카테고리 필터에서 handlePublish 재시도로 변경) 닉네임 설정 모달
  // 제출 — 성공하면 모달을 닫고, 원래 하려던 공개 전환(pendingVisibilityPlaylist +
  // pendingVisibilityCategory)을 바로 이어서 시도함. 중복 닉네임(409)/형식 오류(400)는
  // 모달 안에 인라인 에러로 보여주고 모달은 닫지 않음(다시 입력할 수 있게).
  async function handleSetNickname() {
    if (!pendingVisibilityPlaylist || !pendingVisibilityCategory) return;
    setIsSavingNickname(true);
    setNicknameError(null);
    try {
      await setNickname(nicknameInput);
      const playlist = pendingVisibilityPlaylist;
      const category = pendingVisibilityCategory;
      setIsNicknameModalOpen(false);
      setNicknameInput("");
      await handlePublish(playlist, category);
    } catch (err) {
      if (err instanceof PlaylistApiError && err.status === 409) {
        setNicknameError("이미 사용 중인 닉네임이에요.");
      } else if (err instanceof PlaylistApiError && err.status === 400) {
        setNicknameError("닉네임은 2~20자로 입력해주세요.");
      } else {
        setNicknameError("닉네임을 저장하지 못했어요.");
      }
    } finally {
      setIsSavingNickname(false);
    }
  }

  function handleOpenPublicFeed() {
    setIsPublicFeedOpen(true);
    setViewingPublicPlaylistId(null);
    setPublicPlaylistTracks(null);
    setViewingProfileNickname(null);
    setProfilePlaylists(null);
    setIsLoadingPublicFeed(true);
    getPublicPlaylists()
      .then(setPublicPlaylists)
      .catch(() => setError("공개 재생목록을 불러오지 못했어요."))
      .finally(() => setIsLoadingPublicFeed(false));
  }

  function handleViewPublicPlaylist(playlistId: number) {
    setViewingPublicPlaylistId(playlistId);
    setPublicPlaylistTracks(null);
    getPlaylistTracks(playlistId)
      .then(setPublicPlaylistTracks)
      .catch(() => setError("재생목록 곡을 불러오지 못했어요."));
  }

  // (게이미피케이션 2.5단계) 공개 피드에서 닉네임을 누르면 그 사람이 공개한 재생목록 모음으로 이동.
  function handleViewProfile(nickname: string) {
    setViewingProfileNickname(nickname);
    setProfilePlaylists(null);
    getProfile(nickname)
      .then((res) => setProfilePlaylists(res.playlists))
      .catch(() => setError("프로필을 불러오지 못했어요."));
  }

  // 랭킹 페이지 안 "뒤로" — 곡 목록 화면이면 그걸 닫고(프로필 화면이었으면 프로필로, 아니었으면
  // 피드로 자연히 복귀), 프로필 화면이면 피드로 복귀.
  function handleBackInRanking() {
    if (viewingPublicPlaylistId !== null) {
      setViewingPublicPlaylistId(null);
      setPublicPlaylistTracks(null);
    } else if (viewingProfileNickname !== null) {
      setViewingProfileNickname(null);
      setProfilePlaylists(null);
    }
  }

  // (게이미피케이션 3단계) 좋아요 토글 — 피드/프로필 둘 중 어디서 눌렀는지 모르니 두 목록 다
  // 낙관적으로 갱신(화면에 반영된 뒤 서버 응답으로 정확한 수치로 덮어씀). 실패하면(주로
  // 비로그인 403) 원래 값으로 되돌리고 로그인 모달을 띄움 — 공개 전환(handleToggleVisibility)과
  // 같은 패턴. 정렬 순서는 다음에 피드를 다시 열 때 서버가 최신 좋아요 수 기준으로 다시 내려줌 —
  // 누르는 즉시 카드 위치가 휙휙 바뀌면 오히려 혼란스러울 것 같아 토글 중엔 순서를 그대로 둠.
  async function handleToggleLike(playlist: PublicPlaylist) {
    const nextLiked = !playlist.likedByMe;
    const applyTo = (updater: (p: PublicPlaylist) => PublicPlaylist) => (list: PublicPlaylist[]) =>
      list.map((p) => (p.id === playlist.id ? updater(p) : p));

    const optimistic = applyTo((p) => ({
      ...p,
      likedByMe: nextLiked,
      likeCount: p.likeCount + (nextLiked ? 1 : -1),
    }));
    setPublicPlaylists(optimistic);
    setProfilePlaylists((prev) => (prev ? optimistic(prev) : prev));

    try {
      const result = nextLiked ? await likePlaylist(playlist.id) : await unlikePlaylist(playlist.id);
      const applyServer = applyTo((p) => ({ ...p, likeCount: result.likeCount, likedByMe: result.likedByMe }));
      setPublicPlaylists(applyServer);
      setProfilePlaylists((prev) => (prev ? applyServer(prev) : prev));
    } catch (err) {
      const revert = applyTo(() => playlist);
      setPublicPlaylists(revert);
      setProfilePlaylists((prev) => (prev ? revert(prev) : prev));
      if (err instanceof PlaylistApiError && err.status === 403) {
        setError("좋아요를 누르려면 먼저 로그인해주세요.");
        setIsAuthModalOpen(true);
      } else {
        setError("좋아요 처리에 실패했어요.");
      }
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
    // 새로고침해도 로그인 상태가 유지되도록 Supabase가 localStorage에 저장해둔 세션을 복원.
    // 이후 로그인/로그아웃/토큰 자동 갱신 등 모든 인증 상태 변화를 이 구독 하나로 계속 반영함.
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setUserEmail(data.session?.user.email ?? null);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user.email ?? null);
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // (Phase 5-3) 컨텍스트 인식 탐색 — 버튼 없이 홈 진입 시 바로 위치 권한을 물어봄(사용자
    // 요청, "버튼 굳이 필요할까 그냥 자동으로"). 브라우저 자체 권한 팝업으로 동의를 받는
    // 구조라 사용자 동의 없이 위치를 가져가는 건 아님 — 거부하거나 실패해도 에러 문구 없이
    // 그냥 이 섹션만 안 뜸(다른 홈 화면 기능엔 영향 없음).
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        getContextMood(pos.coords.latitude, pos.coords.longitude)
          .then(setContextMood)
          .catch((err) => {
            // (버그 수정, 2026-10-08) 전엔 에러를 완전히 삼켜서, 권한을 허용해도 섹션이
            // 안 떴을 때 원인을 전혀 알 수 없었음 — 화면엔 여전히 아무것도 안 띄우되
            // (사용자에게 에러 문구를 보여줄 만큼 중요한 기능은 아니라서), 콘솔에는 남겨서
            // 다음에 재현되면 바로 원인 확인 가능하게 함.
            console.warn("[context-mood] 요청 실패:", err);
          });
      },
      (err) => {
        // 거부/타임아웃/위치서비스 꺼짐 등 — 화면엔 조용히 무시하되 콘솔엔 남김(위와 동일 이유)
        console.warn("[context-mood] 위치 가져오기 실패:", err.code, err.message);
      },
      // (버그 수정) 8초는 실내/네트워크 기반 측위가 느린 환경에서 너무 짧을 수 있어 15초로 상향
      { timeout: 15000, maximumAge: 1000 * 60 * 30 }
    );
  }, []);

  useEffect(() => {
    // (Phase 5-3) 감정 다이어리 기록 복원 — 서버에 저장 안 하므로 이 브라우저의
    // localStorage에서만 불러옴. 파싱 실패(옛 포맷/손상)는 조용히 빈 배열로 무시.
    try {
      const raw = localStorage.getItem(DIARY_HISTORY_KEY);
      if (raw) setDiaryHistory(JSON.parse(raw));
    } catch (e) {
      console.warn("[diary] 기록 복원 실패:", e);
    }
  }, []);

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
  }, [favoriteTracks, chartTracks, quickPickRefreshKey]);

  // (UI 재구조화, 2026-10-14) "검색창(전체화면)을 벗어나도 메인 화면에 검색 결과가 그대로
  // 섞여서 나온다"는 피드백 — 지금까지는 검색 결과가 홈 화면 스크롤 중간에 그냥 끼워져서,
  // 검색을 그만두려면 새로고침밖에 방법이 없었음. 아래 "뒤로" 버튼이 이 함수로 검색 관련
  // state를 전부 비워서 홈 화면으로 돌아가게 함 — handleSearch의 에러 처리 분기와 같은 목록을
  // 비우지만, 에러 메시지는 안 지움(사용자가 직접 누른 거라 에러가 아니므로).
  function clearSearchResults() {
    searchBarRef.current?.clear();
    setArtists([]);
    setSearchTracks([]);
    setTagSearchTracks([]);
    setCorrectedArtistName(null);
    setAiGuessedQuery(null);
    setYoutubeFallbackUsed(false);
    setSearchContextArtist(null);
    setSearchArtistTracks([]);
    setSelectedArtist(null);
    setTracks([]);
  }

  // 갤럭시 뒤로가기(제스처/버튼)도 검색 결과 화면을 닫도록: 결과 화면이 뜰 때 history 항목을 하나
  // 쌓아두고, 뒤로가기(popstate)가 오면 앱이 닫히는 대신 결과 화면만 닫음. 화면 안 "뒤로"
  // 버튼으로 닫은 경우엔 쌓아둔 항목을 되돌려서(history.back) 항목이 남지 않게 함.
  const hasSearchResults = searchTracks.length > 0 || tagSearchTracks.length > 0 || artists.length > 0;
  const searchHistoryPushedRef = useRef(false);
  useEffect(() => {
    if (hasSearchResults && !searchHistoryPushedRef.current) {
      window.history.pushState({ unbeatSearch: true }, "");
      searchHistoryPushedRef.current = true;
    } else if (!hasSearchResults && searchHistoryPushedRef.current) {
      searchHistoryPushedRef.current = false;
      if (window.history.state?.unbeatSearch) window.history.back();
    }
  }, [hasSearchResults]);
  useEffect(() => {
    function onPopState() {
      if (searchHistoryPushedRef.current) {
        searchHistoryPushedRef.current = false;
        clearSearchResults();
      }
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSearch(query: string, artist?: string) {
    setError(null);
    setSearchingQuery(query);
    setIsSearching(true);
    setSelectedArtist(null);
    setSelectedMood(null);
    setTracks([]);
    try {
      const data = await search(query, artist);
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

  const moodSheetSwipeRef = useRef<{ x: number; y: number } | null>(null);
  const moodResultRef = useRef<HTMLDivElement | null>(null);

  // 무드 바텀시트 닫기 — 선택한 무드와 결과 곡을 비워서 홈 화면 원래 상태로
  function handleCloseMoodSheet() {
    setSelectedMood(null);
    setDomesticMoodTracks([]);
    setInternationalMoodTracks([]);
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
      // 자동 스크롤 모드: 결과가 렌더된 뒤 그 위치로 부드럽게 이동
      if (MOOD_RESULT_MODE === "scroll") {
        setTimeout(() => moodResultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      }
    } catch (err) {
      setError("무드 곡을 불러오지 못했어요.");
    } finally {
      setIsLoadingMood(false);
    }
  }

  async function handleSubmitDiary() {
    const text = diaryText.trim();
    if (!text) return;
    setDiaryError(null);
    setIsDiaryLoading(true);
    try {
      // 공감 메시지를 먼저 받아 바로 보여주고, 추천곡은 이어서 따로 채움(곡 조회가 느려도
      // "위로받기" 응답이 같이 늦어지지 않게)
      const data = await getDiaryReflection(text, false);
      setDiaryResult(data);
      discoverByMood(data.moodTag)
        .then((tracks) => {
          setDiaryResult((prev) =>
            prev && prev.moodTag === data.moodTag
              ? { ...prev, domesticTracks: tracks.domesticTracks, internationalTracks: tracks.internationalTracks }
              : prev
          );
        })
        .catch((e) => console.warn("[diary] 추천곡 조회 실패:", e));
      const entry: DiaryHistoryEntry = {
        date: new Date().toISOString().slice(0, 10),
        at: new Date().toISOString(),
        text,
        message: data.message,
        moodLabel: data.moodLabel,
      };
      // 최신순으로 맨 앞에 추가, 너무 쌓이지 않게 최근 10개까지만 보관
      const nextHistory = [entry, ...diaryHistory].slice(0, DIARY_HISTORY_CAP);
      setDiaryHistory(nextHistory);
      try {
        localStorage.setItem(DIARY_HISTORY_KEY, JSON.stringify(nextHistory));
      } catch (e) {
        console.warn("[diary] 기록 저장 실패:", e);
      }
      setDiaryText("");
    } catch (err) {
      setDiaryError("응답을 받지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setIsDiaryLoading(false);
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
    // (UI 재구조화, 2026-10-14) recentSearches 원소가 string에서 {query, image} 객체로 바뀌어서
    // 비교 기준을 entry.query로 변경.
    setRecentSearches((prev) => prev.filter((entry) => entry.query !== query));
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
      // 이전곡 버튼으로 돌아가는 재생이면 true — 히스토리에 현재 곡을 다시 쌓지 않음
      skipHistory?: boolean;
    }
  ) {
    setError(null);
    try {
      // 유튜브 인기 급상승(getYoutubeChart) 트랙은 videoId를 이미 알고 있어서, 굳이 다시
      // /youtube-search(호출당 100유닛)를 태우지 않고 바로 재생함 — 아낀 쿼터로 재생 검색을
      // 더 여유 있게 쓸 수 있음.
      const videoId = track.videoId ?? (await searchYoutubeVideo(track.artist, track.name)).videoId;
      if (videoId) {
        const prev = nowPlayingRef.current;
        if (prev && !options?.skipHistory && prev.videoId !== videoId) {
          playHistoryRef.current = [...playHistoryRef.current, prev].slice(-30);
        }
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

  // (Task #44-3) "믹스" 버튼 — 무드 칩을 선택해둔 상태면 "신나는 곡 듣다가 갑자기 발라드
  // 나오면 안 된다"는 요청대로 그 무드의 곡 목록(국내+해외)을 셔플해서 고정 큐로 재생 —
  // 재생목록 "이어재생"과 똑같은 manualNext 방식이라, 곡이 끝나도 유사곡 추천(장르 무관)으로
  // 안 새고 같은 무드 안에서만 순서대로 이어짐. 무드를 선택 안 해뒀으면 기존처럼 "빠른 선곡"
  // 풀(없으면 글로벌 차트)에서 무작위 시작 + 평소의 유사곡 라디오 큐로 이어짐.
  // highlight가 true면 재생 시작과 동시에 MiniPlayer의 연속 하이라이트 모드도 같이 켜서, 그
  // 뒤로는 하이라이트만 이어서 계속 재생됨 — false면 평소처럼 전곡이 이어짐.
  function handleStartMix(highlight: boolean) {
    const moodPool = [...domesticMoodTracks, ...internationalMoodTracks];
    if (selectedMood && moodPool.length > 0) {
      const [first, ...rest] = shuffleArray(moodPool);
      handlePlay(first, { manualNext: rest });
    } else {
      const pool = quickPickTracks.length > 0 ? quickPickTracks : chartTracks;
      if (pool.length === 0) return;
      const randomTrack = pool[Math.floor(Math.random() * pool.length)];
      handlePlay(randomTrack);
    }
    mixRequestIdRef.current += 1;
    setMixRequest({ id: mixRequestIdRef.current, highlight });
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
    if (nativeOverride) {
      // 안드로이드 헤드리스 웹뷰가 이미 재생을 시작한 곡이라 영상 존재가 보장됨 — 검색/스킵
      // 없이 바로 반영.
      const next = withOverride(queue[0]);
      if (next) handlePlay(next, { fromQueue: true });
      return;
    }
    // (버그 수정) 큐 맨 앞 곡의 유튜브 영상을 못 찾으면 거기서 완전히 멈춰버리던 문제 발견
    // (§44 하이라이트 연속재생 라이브 확인 중 — 일반 자동 이어재생에도 원래 있던 한계였는데,
    // 연속 하이라이트가 자동전환을 훨씬 자주 트리거해서 더 쉽게 드러남). 재생 가능한 곡을
    // 찾을 때까지 큐를 순서대로 넘겨가며 시도하도록 변경.
    playFirstPlayableFromQueue(queue);
  }

  // handleTrackEnded 전용 헬퍼 — 큐를 앞에서부터 순서대로 시도해서 유튜브 영상이 실제로
  // 있는 첫 곡을 재생. 건너뛴 곡은 큐에서 따로 제거하지 않음(다음에 또 맨 앞으로 와도 똑같이
  // 건너뛰어질 뿐이라 무해하고, 상태 동기화를 단순하게 유지하기 위함). 끝까지 하나도 못
  // 찾으면 기존과 동일하게 에러만 띄우고 지금 재생 중이던 곡은 그대로 유지.
  async function playFirstPlayableFromQueue(candidates: Track[]) {
    for (const t of candidates) {
      try {
        const { videoId } = await searchYoutubeVideo(t.artist, t.name);
        if (videoId) {
          handlePlay({ ...t, videoId }, { fromQueue: true });
          return;
        }
      } catch {
        // 이 후보만 실패 처리하고 다음 후보로 계속 시도.
      }
    }
    if (candidates.length > 0) {
      setError("다음 트랙 중 재생 가능한 영상을 찾지 못했어요.");
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
  //
  // (이미지 보강, 2026-10-10) "다시 듣기"에 이미지 없는 곡이 많다"는 피드백 — iTunes/Last.fm
  // 둘 다 이미지가 없는 비공식/리믹스/쇼미더머니류 곡은 원래도 있었고, 백엔드가 "빠른 선곡"/
  // "다음 트랙"에만 유튜브 썸네일로 보강해주고 있었음(§85, 유튜브 검색 API 쿼터 때문에 전체
  // 목록엔 일부러 안 걸어둠 — 다시 듣기처럼 곡이 많은 목록에 걸면 화면 하나에 하루 쿼터를
  // 다 쓸 수 있어서). 그런데 "다시 듣기"에 들어오는 곡은 전부 이미 실제로 재생을 시작한
  // 곡이라 videoId를 이미 알고 있고, 썸네일 URL(i.ytimg.com/vi/{videoId}/...)은 검색 없이
  // videoId만으로 바로 만들 수 있는 무료 정적 URL이라 쿼터를 전혀 안 씀 — 이 지점에서만큼은
  // "이미 아는 videoId로 보강"이 공짜라서 적용 안 할 이유가 없음.
  function handleActuallyPlaying(track: {
    name: string;
    artist: string;
    image?: string | null;
    videoId?: string;
  }) {
    const existing = favoriteTracks.find(
      (f) => f.artistName === track.artist && f.trackName === track.name
    );
    if (existing) {
      markFavoriteTrackOpened(existing.id).catch(() => {});
    }

    const resolvedImage =
      track.image ?? (track.videoId ? `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg` : null);

    // (§49) "다시 듣기" 홈 섹션용 최근 재생 기록. 즐겨찾기 여부와 무관하게 재생을 시작한
    // 모든 곡을 기록 — 화면에는 즉시 반영(맨 앞으로, 중복 제거)하고 서버 기록은 백그라운드로.
    setRecentPlays((prev) => [
      { name: track.name, artist: track.artist, listeners: null, url: "", image: resolvedImage },
      ...prev.filter((t) => !(t.artist === track.artist && t.name === track.name)),
    ]);
    recordRecentPlay(track.artist, track.name, undefined, resolvedImage ?? undefined).catch(() => {});
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
            {/* (UI 재구조화, 2026-10-14) 유튜브 뮤직처럼 로고 옆에 검색/프로필 아이콘을 두고
                하단 탭바는 4개(홈/보관함/랭킹/하이라이트)로 줄이기로 함 — 그래서 SearchBar의
                모바일 전용 돋보기 아이콘을 더 이상 숨기지 않음(hideMobileTrigger 제거, 헤더에서
                바로 보이게). 전체화면 검색 자체는 그대로 SearchBar 내부 로직 재사용. */}
            <SearchBar
              ref={searchBarRef}
              onSearch={handleSearch}
              isLoading={isSearching}
              recentSearches={recentSearches}
              onRemoveRecent={handleRemoveRecent}
            />
            {/* (하단 탭바 도입) "보관함"은 이제 하단 탭바가 폰 화면(sm 미만)에서 전담해서
                여기 아이콘은 더 안 그림 — 탯 화면(sm~lg)에서는 사이드바가 아직 없어서 접근할
                방법이 필요하므로 그 구간만 보이게 둠(hidden sm:flex lg:hidden). */}
            <button
              type="button"
              aria-label="보관함"
              onClick={() => setIsLibraryOpen(true)}
              className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/80 hover:bg-white/10 sm:flex lg:hidden"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <path d="M19 21V8a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v13l7-4 7 4Z" />
              </svg>
            </button>
            {/* (게이미피케이션, UI 재구조화 2026-10-10) 랭킹 페이지 — 폰은 하단 탭바가 전담하지만,
                보관함/프로필과 달리 데스크톱엔 이걸 대신할 상시 사이드바가 없어서 lg에서도 계속
                보이게 둠(보관함 아이콘과 다르게 lg:hidden을 안 붙임). */}
            <button
              type="button"
              aria-label="랭킹"
              onClick={handleOpenPublicFeed}
              className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/80 hover:bg-white/10 sm:flex"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <path d="M8 21h8M12 17v4M7 4h10l-1 7a4 4 0 0 1-8 0L7 4Z" />
                <path d="M5 4H3v2a4 4 0 0 0 4 4M19 4h2v2a4 4 0 0 1-4 4" />
              </svg>
            </button>
            {/* (UI 재구조화, 2026-10-14) 원래는 하단 탭바의 "프로필" 탭이 폰 화면을 전담해서
                이 아이콘은 탭 화면(sm~lg)에서만 보였는데, 하단 탭바에서 "프로필" 탭을 빼고
                유튜브 뮤직처럼 헤더 아이콘으로 옮기면서 폰 화면(sm 미만)에서도 보이게 함
                (hidden/sm:flex 제거). 로그인 상태면 (§버그수정 2026-10-08과 동일한 이유로)
                바로 로그아웃시키지 않고 이메일 확인용 바텀시트를 먼저 띄움 — 예전엔 이 버튼이
                바로 signOut()을 호출해서 탭 화면에서만 "실수로 즉시 로그아웃" 버그가 있었는데,
                이제 폰 화면에서도 똑같이 쓰이니 하단 탭바 "프로필"과 동작을 통일함. */}
            <button
              type="button"
              aria-label={userEmail ? "프로필" : "로그인"}
              onClick={() => (userEmail ? setIsProfileSheetOpen(true) : setIsAuthModalOpen(true))}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/80 hover:bg-white/10 lg:hidden"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
              </svg>
            </button>
          </div>
          {/* 로그인은 선택 기능이라(ROADMAP 5-2) 안 눌러도 기존 기능 전부 그대로 동작함.
              로그인하면 이메일 일부 + 로그아웃 버튼으로 바뀜. */}
          <div className="hidden items-center justify-end lg:flex">
            {userEmail ? (
              <button
                type="button"
                onClick={async () => {
                  await supabase?.auth.signOut();
                }}
                className="truncate rounded-full px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
                title={userEmail}
              >
                {userEmail.split("@")[0]} · 로그아웃
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsAuthModalOpen(true)}
                className="rounded-full px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
              >
                로그인
              </button>
            )}
          </div>
        </div>
      </header>
      {/* 모바일은 검색을 누르면 전체화면 검색창이 바로 닫혀서, 결과가 올 때까지 아무 변화 없이
          메인 화면만 보였음("검색이 안 되고 그냥 메인으로 간다"는 피드백 5-1). 결과가 올 때까지
          로딩 표시를 띄워서 검색이 진행 중이라는 걸 알 수 있게 함. */}
      {isSearching && (
        <div className="sticky top-[57px] z-10 flex items-center justify-center gap-2 border-b border-white/10 bg-neutral-900/95 px-4 py-2.5 text-sm text-white/80 backdrop-blur">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          &quot;{searchingQuery}&quot; 검색 중...
        </div>
      )}

      {/* 모바일 "보관함" 전체화면 서랍 — 즐겨찾기 아티스트/즐겨찾기 곡/내 재생목록을 데스크톱
          사이드바와 완전히 같은 내용(renderFavoriteArtists/renderLibraryPanel)으로 보여줌. */}
      {isLibraryOpen && (
        <div className="animate-slide-up-in fixed inset-0 z-50 flex h-screen w-screen flex-col bg-black sm:hidden">
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
      className={`mx-auto grid min-h-screen max-w-6xl grid-cols-1 gap-6 px-6 pt-7 lg:grid-cols-[200px_1fr_200px] ${
        // 하단 탭바(모바일 전용, 높이 약 64px)가 생기면서 그만큼 여백을 더 얹어야
        // 본문 마지막 줄이 탭바 뒤에 깔리지 않음. sm 이상은 탭바가 안 보이니 기존 값 유지.
        nowPlaying ? "pb-56 sm:pb-28" : "pb-[104px] sm:pb-10"
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

      {/* (Phase 5-3) 감정 다이어리 — 처음엔 이 자리에 입력창을 통째로 깔아놨는데, "곡 훑어보는
          스크롤 흐름 중간에 글 쓰는 칸이 끼어있는 게 안 어울린다"는 피드백으로 작은 진입
          버튼만 남기고 실제 입력/결과는 모달로 분리함(아래 isDiaryOpen 모달 참고). */}
      <button
        type="button"
        onClick={() => setIsDiaryOpen(true)}
        className="flex w-full max-w-xl items-center gap-2 rounded-xl border border-white/10 bg-neutral-900/60 px-4 py-3 text-left hover:border-white/20"
      >
        <span className="flex-1 text-sm text-white/70">오늘 하루 어땠나요? 기분을 적으면 어울리는 곡을 추천해드려요</span>
        {diaryHistory.length > 0 && (
          <span className="text-[11px] text-white/30">기록 {diaryHistory.length}</span>
        )}
      </button>

      {/* "빠른 선곡" — 원래 "인기 있는 곡(글로벌)"/"다시 듣기" 밑, 스크롤을 몇 번 내려야 나오는
          자리에 있었음. "폰으로 처음 들어가면 무드 칩 밑으로 화면이 비어 보인다"는 피드백으로
          검색창/무드 칩 바로 아래로 끌어올림 — 즐겨찾기가 없는 첫 방문자도 chartTracks 폴백으로
          곧바로 곡이 채워진다(§아래 useEffect 참고). "인기 있는 곡(글로벌)"은 실제 차트라
          새로고침해도 고정돼야 맞는데 "유튜브 뮤직처럼 매번 좀 달라졌으면 좋겠다"는 피드백을 받아
          따로 둔 섹션. 처음엔 즐겨찾기 태그/아티스트 기반 셔플이었는데([[학습노트 37번]]), 이후
          실제 Claude Haiku 4.5 LLM 추천으로 교체함([[학습노트 38번]], 실패 시에만 셔플로 폴백). */}
      {quickPickTracks.length > 0 && (
        <div className="w-full max-w-xl">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs text-white/40">빠른 선곡</p>
            {/* (Task #44-3) "믹스" 버튼 2개 — 특정 곡을 고르지 않고 눌러서 바로 무작위 재생을
                시작하는 전용 진입점. MiniPlayer 안의 번개 토글(지금 재생 중인 곡 하나에 대해
                하이라이트 모드를 켜고 끔)과는 다른, "처음부터 하이라이트/전곡 중 하나를 골라
                믹스를 시작"하는 버튼이 따로 있었으면 좋겠다는 요청으로 추가. */}
            {/* (B단계 3-3, 2026-10-25) 하이라이트 믹스는 하단 탭의 "하이라이트"와 똑같은 동작이라
                중복이어서 뺌 — 대신 "새로고침"(추천 다시 받기)과 "모두 재생"(구 전체 믹스)만 둠. */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setQuickPickRefreshKey((k) => k + 1)}
                aria-label="새로고침"
                className="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-sm text-white/60 hover:border-white/30 hover:text-white"
                title="추천 곡 새로 받기"
              >
                ↻
              </button>
              <button
                type="button"
                onClick={() => handleStartMix(false)}
                aria-label="모두 재생"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-[11px] text-black hover:bg-white/80"
                title={
                  selectedMood
                    ? `"${selectedMoodLabel}" 무드 안에서만 전곡 재생`
                    : "모두 재생"
                }
              >
                ▶
              </button>
            </div>
          </div>
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

      {/* (B단계 3-2, 2026-10-22) 무드 칩을 눌러도 결과가 화면 한참 아래에 나와서 변화가 안 보인다는
          피드백 — 모바일(sm 미만)은 결과를 아래에서 올라오는 바텀시트로 띄워서 바로 보이게 함(위로
          쓸어내리듯 아래로 쓸면 닫힘). 데스크톱(sm 이상)은 원래처럼 인라인으로 그대로 둠. 재생바(z-30)
          아래(z-25)에 두고, 재생 중이면 재생바 위로 올려서 재생바를 안 가리게 함. */}
      {selectedMood && (
        <div
          ref={moodResultRef}
          className={
            MOOD_RESULT_MODE === "sheet"
              ? `fixed inset-x-0 z-[25] flex max-h-[62dvh] flex-col rounded-t-2xl border-t border-white/10 bg-neutral-950 shadow-2xl ${
                  nowPlaying ? "bottom-[8.5rem]" : "bottom-16"
                } sm:static sm:z-auto sm:max-h-none sm:w-full sm:max-w-xl sm:rounded-none sm:border-0 sm:bg-transparent sm:shadow-none`
              : "w-full max-w-xl scroll-mt-20"
          }
        >
          <div
            // 터치와 마우스(Mac 반응형 미리보기 테스트용) 모두 받도록 포인터 이벤트 사용.
            // 헤더 안 버튼(믹스 재생/새로고침/✕)을 누르는 건 드래그로 취급하지 않음.
            className={`shrink-0 touch-none select-none px-4 pb-2 pt-2 sm:hidden ${
              MOOD_RESULT_MODE === "sheet" ? "" : "hidden"
            }`}
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest("button")) return;
              moodSheetSwipeRef.current = { x: e.clientX, y: e.clientY };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerUp={(e) => {
              const start = moodSheetSwipeRef.current;
              moodSheetSwipeRef.current = null;
              if (!start) return;
              const dy = e.clientY - start.y;
              if (dy > 50 && dy > Math.abs(e.clientX - start.x) * 1.5) {
                handleCloseMoodSheet();
              }
            }}
            onPointerCancel={() => {
              moodSheetSwipeRef.current = null;
            }}
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-white/20" />
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">&quot;{selectedMoodLabel}&quot;</p>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleStartMix(false)}
                  className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-black"
                >
                  믹스 재생
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectMood(selectedMood)}
                  className="rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-white/70"
                >
                  새로고침
                </button>
                <button
                  type="button"
                  onClick={handleCloseMoodSheet}
                  aria-label="닫기"
                  className="rounded-full p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
                >
                  ✕
                </button>
              </div>
            </div>
          </div>
          <div
            className={
              MOOD_RESULT_MODE === "sheet"
                ? "overflow-y-auto px-4 pb-4 sm:overflow-visible sm:p-0"
                : "w-full"
            }
          >
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
          </div>
        </div>
      )}

      {/* (UI 재구조화, 2026-10-14) 검색 결과 영역(검색된 곡/관련 곡/검색된 아티스트/비슷한
          아티스트 곡/"OO의 다른 곡") 전체를 모바일(sm 미만)에서만 전체화면으로 덮어서, 홈 피드랑
          시각적으로 섞이지 않게 함 — 유튜브 뮤직처럼 "검색은 검색대로 별도 화면"이 되게 하려는
          목적. 데스크톱(sm 이상)은 원래처럼 인라인으로 그대로 둠(화면이 넓어서 안 섞여 보였고,
          피드백도 모바일 한정이었음). 검색 결과가 하나도 없으면 이 래퍼 자체가 아예 없는 셈이라
          평소 홈 화면엔 전혀 영향 없음. */}
      {(searchTracks.length > 0 || tagSearchTracks.length > 0 || artists.length > 0) && (
        <div
          className="fixed inset-0 z-20 flex flex-col gap-6 overflow-y-auto bg-black p-4 pb-44 sm:static sm:z-auto sm:flex sm:flex-col sm:gap-6 sm:overflow-visible sm:bg-transparent sm:p-0"
          // 아이폰처럼 화면 왼쪽 가장자리에서 오른쪽으로 쓸어서 뒤로 가기(모바일 전용 — 가로 스크롤 목록과
          // 안 겹치게 왼쪽 가장자리 48px에서 시작한 제스처만 인정).
          onTouchStart={(e) => {
            const t = e.touches[0];
            swipeBackRef.current = t.clientX <= 48 ? { x: t.clientX, y: t.clientY } : null;
          }}
          onTouchEnd={(e) => {
            const start = swipeBackRef.current;
            swipeBackRef.current = null;
            if (!start) return;
            const t = e.changedTouches[0];
            if (t.clientX - start.x > 70 && Math.abs(t.clientY - start.y) < 60) {
              clearSearchResults();
            }
          }}
        >
          <button
            type="button"
            onClick={clearSearchResults}
            className="sticky top-0 z-10 -mx-4 -mt-4 flex items-center gap-1 bg-black/95 px-4 py-4 text-base text-white/80 hover:text-white sm:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path d="m15 18-6-6 6-6" />
            </svg>
            뒤로
          </button>
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

      {/* (Phase 5-3) 컨텍스트 인식 탐색 — GPS+날씨로 자동 선택된 무드 추천. 검색 중이거나
          사용자가 직접 무드 칩을 골랐을 때는 그쪽이 우선이니 숨김(결과가 두 개 겹쳐서
          뜨면 헷갈림). "스크롤 내리면 나오는 부분" 요청으로 글로벌 차트 밑, 다시 듣기 위에 배치. */}
      {!searchContextArtist && !selectedMood && contextMood && (
        <div className="w-full max-w-xl">
          <p className="mb-2 text-xs text-white/40">
            {contextMood.description} · &quot;{contextMood.moodLabel}&quot; 추천
          </p>
          {contextMood.domesticTracks.length > 0 && (
            <div className="mb-6">
              <CompactTrackGrid
                tracks={contextMood.domesticTracks}
                isFavorite={isTrackFavorite}
                onToggleFavorite={handleToggleFavoriteTrack}
                onPlay={handlePlay}
                onAddToPlaylist={handleOpenAddToPlaylist}
                scrollable
              />
            </div>
          )}
          {contextMood.internationalTracks.length > 0 && (
            <CompactTrackGrid
              tracks={contextMood.internationalTracks}
              isFavorite={isTrackFavorite}
              onToggleFavorite={handleToggleFavoriteTrack}
              onPlay={handlePlay}
              onAddToPlaylist={handleOpenAddToPlaylist}
              scrollable
            />
          )}
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
          <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
            {topArtists.map((artist) => (
              <div key={artist.name} className="w-64 shrink-0 snap-start snap-always">
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

    {/* 모바일 하단 탭바 — "하단 네비게이션이 없음" 피드백 반영. 데스크톱/탭 화면(sm 이상)은
        기존 헤더 아이콘·사이드바로 충분해서 폰 화면(sm 미만)에만 둠. 미니 플레이어(z-30, bottom-0)
        와 겹치지 않도록 미니 플레이어 쪽을 bottom-16으로 올려서 이 탭바 위에 쌓이게 함.
        (UI 재구조화, 2026-10-14) 원래 홈/검색/보관함/랭킹/프로필 5개였는데, "검색"/"프로필"을
        유튜브 뮤직처럼 로고 옆 헤더 아이콘으로 옮기고 하단은 홈/보관함/랭킹/하이라이트 4개로
        줄임 — 탭이 너무 많다는 피드백 반영. */}
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch justify-between border-t border-white/10 bg-black/95 px-2 backdrop-blur sm:hidden"
      aria-label="하단 메뉴"
    >
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className="flex flex-1 flex-col items-center justify-center gap-1 text-[11px]"
        style={{ color: "#ff3b5c" }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
          <path d="M4 11.5 12 4l8 7.5" />
          <path d="M6 10v10h5v-6h2v6h5V10" />
        </svg>
        홈
      </button>
      <button
        type="button"
        onClick={() => setIsLibraryOpen(true)}
        className="flex flex-1 flex-col items-center justify-center gap-1 text-[11px] text-white/70"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
          <path d="M19 21V8a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v13l7-4 7 4Z" />
        </svg>
        보관함
      </button>
      {/* (게이미피케이션, UI 재구조화 2026-10-10) 처음엔 재생목록 상세 화면 안 작은 🌐 아이콘으로
          넣었는데, "게이미피케이션 기능인데 아이콘 하나로 나오니 이상하다, 랭킹 페이지를 따로
          두는 게 낫겠다"는 라이브 피드백을 받고 다른 탭들과 동급인 전용 탭으로 승격함. */}
      <button
        type="button"
        onClick={handleOpenPublicFeed}
        className="flex flex-1 flex-col items-center justify-center gap-1 text-[11px] text-white/70"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
          <path d="M8 21h8M12 17v4M7 4h10l-1 7a4 4 0 0 1-8 0L7 4Z" />
          <path d="M5 4H3v2a4 4 0 0 0 4 4M19 4h2v2a4 4 0 0 1-4 4" />
        </svg>
        랭킹
      </button>
      {/* (UI 재구조화, 2026-10-14) "검색"/"프로필" 탭을 헤더 아이콘(로고 옆)으로 옮기면서 빈
          4번째 자리에 뭘 넣을지 물었고, 홈 화면 "빠른 선곡"의 하이라이트 믹스 재생을 하단 탭
          어디서든 바로 시작할 수 있는 단축 버튼으로 넣기로 함 — 다른 탭들처럼 화면을 바꾸는 게
          아니라 handleStartMix(true)를 바로 실행하는 "액션 버튼"이라는 점이 다름(눌러도 현재
          화면은 그대로 유지되고 재생만 시작됨). */}
      <button
        type="button"
        onClick={() => handleStartMix(true)}
        className="flex flex-1 flex-col items-center justify-center gap-1 text-[11px] text-white/70"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
          <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" strokeLinejoin="round" />
        </svg>
        하이라이트
      </button>
    </nav>

    {/* 로그인 상태 확인용 바텀시트 — "로그인됐는지 안 됐는지 안 보인다"는 혼란 때문에 추가.
        프로필 탭을 눌렀을 때 바로 로그아웃시키는 대신, 이메일을 먼저 보여주고 로그아웃은
        버튼을 한 번 더 눌러야 실행되게 함(실수로 즉시 로그아웃되는 것도 같이 방지). */}
    {isProfileSheetOpen && userEmail && (
      <div
        className="animate-slide-up-in fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:hidden"
        onClick={() => setIsProfileSheetOpen(false)}
      >
        <div
          className="w-full rounded-t-xl border-t border-white/10 bg-neutral-900 p-5 pb-8"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mb-1 text-xs text-white/40">로그인됨</p>
          <p className="mb-4 truncate text-sm font-medium">{userEmail}</p>
          <button
            type="button"
            onClick={async () => {
              await supabase?.auth.signOut();
              setIsProfileSheetOpen(false);
            }}
            className="w-full rounded-md border border-white/15 px-3 py-2.5 text-sm text-white/80 hover:bg-white/10"
          >
            로그아웃
          </button>
        </div>
      </div>
    )}

    {/* 하단 고정 미니 플레이어 — Last.fm 페이지로도, 눈에 보이는 유튜브 iframe으로도 안 나가고
        Unbeat 자체 UI로 재생/일시정지/진행바를 직접 그림 (MiniPlayer 내부에서 처리) */}
    {nowPlaying && (
      <MiniPlayer
        track={nowPlaying}
        onClose={() => setNowPlaying(null)}
        onActuallyPlaying={() => handleActuallyPlaying(nowPlaying)}
        onEnded={() => handleTrackEnded()}
        onNext={() => handleTrackEnded()}
        onAddCurrentToPlaylist={() =>
          nowPlaying &&
          handleOpenAddToPlaylist({ name: nowPlaying.name, artist: nowPlaying.artist, image: nowPlaying.image })
        }
        onPrevious={() => {
          const prev = playHistoryRef.current[playHistoryRef.current.length - 1];
          if (!prev) return;
          playHistoryRef.current = playHistoryRef.current.slice(0, -1);
          handlePlay(prev, { skipHistory: true });
        }}
        onNativeAutoAdvance={(data) =>
          handleTrackEnded({ videoId: data.videoId, name: data.title, artist: data.artist })
        }
        mixRequest={mixRequest}
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
            onToggleVisibility={() => handleToggleVisibility(playlist)}
            isTogglingVisibility={isTogglingVisibility}
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

    {isAuthModalOpen && (
      <AuthModal
        onClose={() => {
          setIsAuthModalOpen(false);
          resumePublishRef.current = null;
        }}
        onAuthSuccess={() => {
          // userEmail은 onAuthStateChange 구독이 곧 알아서 채워주지만, 로그인 직후
          // 버튼 텍스트가 바뀌는 게 한 박자 늦어 보이지 않도록 여기서도 즉시 갱신 시도.
          supabase?.auth.getSession().then(({ data }) => {
            setUserEmail(data.session?.user.email ?? null);
          });
          // 공개 전환하다가 로그인하러 온 거면, 로그인 성공 직후 카테고리 선택부터 이어서 진행
          const resume = resumePublishRef.current;
          resumePublishRef.current = null;
          if (resume) {
            setPendingVisibilityPlaylist(resume);
            setSelectedCategory(null);
            setIsCategoryModalOpen(true);
          }
        }}
      />
    )}

    {/* (Phase 5-3) 감정 다이어리 모달 — AuthModal과 같은 "화면 중앙 모달" 패턴(fixed inset-0 +
        z-50 + 배경 클릭 시 닫힘). 홈 피드엔 작은 진입 버튼만 남기고 실제 입력/결과는 여기로 분리. */}
    {isDiaryOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
        onClick={() => setIsDiaryOpen(false)}
      >
        <div
          className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-white/10 bg-neutral-900 p-5"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-white/90">오늘 하루 어땠나요?</p>
            <button
              type="button"
              onClick={() => setIsDiaryOpen(false)}
              className="text-white/40 hover:text-white/70"
            >
              닫기
            </button>
          </div>

          <textarea
            value={diaryText}
            onChange={(e) => setDiaryText(e.target.value)}
            maxLength={DIARY_TEXT_MAX_LENGTH}
            autoCorrect="off"
            autoCapitalize="off"
            placeholder="오늘 있었던 일이나 지금 기분을 편하게 적어보세요"
            rows={4}
            autoFocus
            className="w-full resize-none rounded-md border border-white/10 bg-black/30 p-3 text-sm text-white placeholder:text-white/30 focus:border-accent focus:outline-none"
          />
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-[11px] text-white/30">
              {diaryText.length}/{DIARY_TEXT_MAX_LENGTH}
            </span>
            <button
              type="button"
              onClick={handleSubmitDiary}
              disabled={!diaryText.trim() || isDiaryLoading}
              className="rounded-full bg-accent px-4 py-1.5 text-xs font-medium text-black disabled:opacity-40"
            >
              {isDiaryLoading ? "읽는 중..." : "위로받기"}
            </button>
          </div>

          {diaryError && <p className="mt-2 text-xs text-red-400">{diaryError}</p>}

          {diaryResult && (
            <div className="mt-4 border-t border-white/10 pt-4">
              <p className="text-sm leading-relaxed text-white/90">{diaryResult.message}</p>
              <p className="mb-2 mt-3 text-xs text-white/40">
                &quot;{diaryResult.moodLabel}&quot; 어울리는 곡
              </p>
              {diaryResult.domesticTracks.length > 0 && (
                <div className="mb-2">
                  <CompactTrackGrid
                    tracks={diaryResult.domesticTracks}
                    isFavorite={isTrackFavorite}
                    onToggleFavorite={handleToggleFavoriteTrack}
                    onPlay={handlePlay}
                    onAddToPlaylist={handleOpenAddToPlaylist}
                    scrollable
                  />
                </div>
              )}
              {diaryResult.internationalTracks.length > 0 && (
                <CompactTrackGrid
                  tracks={diaryResult.internationalTracks}
                  isFavorite={isTrackFavorite}
                  onToggleFavorite={handleToggleFavoriteTrack}
                  onPlay={handlePlay}
                  onAddToPlaylist={handleOpenAddToPlaylist}
                  scrollable
                />
              )}
            </div>
          )}

          {diaryHistory.length > 0 && (
            <div className="mt-4 border-t border-white/10 pt-3">
              <button
                type="button"
                onClick={() => setIsDiaryHistoryOpen((v) => !v)}
                className="text-xs text-white/40 hover:text-white/70"
              >
                {isDiaryHistoryOpen ? "기록 접기" : `최근 기록 보기 (${diaryHistory.length})`}
              </button>
              {isDiaryHistoryOpen && (
                <ul className="mt-2 space-y-2">
                  {diaryHistory.map((entry, i) => (
                    <li key={`${entry.at ?? entry.date}-${i}`} className="rounded-md bg-black/20 p-2 text-xs">
                      <div className="flex items-center justify-between text-white/40">
                        <span>
                          {entry.at
                            ? new Date(entry.at).toLocaleString("ko-KR", {
                                month: "numeric",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : entry.date}
                        </span>
                        <span>&quot;{entry.moodLabel}&quot;</span>
                      </div>
                      {entry.text && (
                        <p className="mt-1 whitespace-pre-wrap break-words text-white/50">
                          내 일기: {entry.text}
                        </p>
                      )}
                      <p className="mt-1 text-white/70">{entry.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    )}

    {/* (게이미피케이션, UI 재구조화) 다른 사용자가 공개한 재생목록 둘러보기 — 전용 전체화면
        페이지로 분리(RankingPage.tsx, PlaylistDetailOverlay와 같은 패턴). */}
    {isPublicFeedOpen && (
      <RankingPage
        onClose={() => setIsPublicFeedOpen(false)}
        publicPlaylists={publicPlaylists}
        isLoading={isLoadingPublicFeed}
        viewingProfileNickname={viewingProfileNickname}
        profilePlaylists={profilePlaylists}
        viewingPlaylistId={viewingPublicPlaylistId}
        tracks={publicPlaylistTracks}
        onSelectPlaylist={handleViewPublicPlaylist}
        onViewProfile={handleViewProfile}
        onBack={handleBackInRanking}
        onPlayTrack={(track) => {
          handlePlay(track);
          setIsPublicFeedOpen(false);
        }}
        onToggleLike={handleToggleLike}
      />
    )}

    {/* (랭킹 카테고리 필터, 2026-10-10 추가) 재생목록을 비공개 -> 공개로 전환하려 할 때 먼저
        뜨는 카테고리 선택 모달 — 닉네임 모달과 같은 "화면 중앙 모달" 패턴, 칩은 MoodChips
        스타일을 그대로 가져옴(디자인 재사용, 새 스타일 안 만듦). 선택 후 "선택하고 공개하기"를
        누르면 handlePublish가 실제 API를 호출함. */}
    {isCategoryModalOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
        onClick={() => {
          if (!isTogglingVisibility) {
            setIsCategoryModalOpen(false);
            setPendingVisibilityPlaylist(null);
            setSelectedCategory(null);
          }
        }}
      >
        <div
          className="w-full max-w-sm rounded-lg border border-white/10 bg-neutral-900 p-5"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mb-1 text-sm font-medium text-white/90">카테고리를 선택해주세요</p>
          <p className="mb-3 text-xs text-white/40">
            랭킹 피드에서 어떤 장르인지 필터링할 수 있게 쓰여요. 나중에 다시 공개 전환하면서
            바꿀 수도 있어요.
          </p>
          <div className="mb-2 flex flex-wrap gap-2">
            {MUSIC_CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                onClick={() => setSelectedCategory(c.value)}
                className={`shrink-0 rounded-full border px-4 py-2 text-sm transition ${
                  selectedCategory === c.value
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-white/10 bg-white/5 hover:border-white/30"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              disabled={isTogglingVisibility}
              onClick={() => {
                setIsCategoryModalOpen(false);
                setPendingVisibilityPlaylist(null);
                setSelectedCategory(null);
              }}
              className="rounded-md px-3 py-1.5 text-sm text-white/60 hover:bg-white/10 disabled:opacity-40"
            >
              취소
            </button>
            <button
              type="button"
              disabled={isTogglingVisibility || !selectedCategory}
              onClick={() => {
                if (pendingVisibilityPlaylist && selectedCategory) {
                  handlePublish(pendingVisibilityPlaylist, selectedCategory);
                }
              }}
              className="rounded-md bg-accent px-3 py-1.5 text-sm text-black disabled:opacity-40"
            >
              {isTogglingVisibility ? "전환 중..." : "선택하고 공개하기"}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* (게이미피케이션 2.5단계, 카테고리 필터에서 pendingVisibilityCategory 추가) 재생목록을
        공개로 전환하려는데 닉네임이 없을 때(428) 뜨는 모달 — AuthModal/감정 다이어리와 같은
        "화면 중앙 모달" 패턴. 저장되면 자동으로 원래 하려던 공개 전환(카테고리 포함)을 이어서
        시도함(handleSetNickname). */}
    {isNicknameModalOpen && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
        onClick={() => {
          if (!isSavingNickname) {
            setIsNicknameModalOpen(false);
            setPendingVisibilityPlaylist(null);
            setPendingVisibilityCategory(null);
          }
        }}
      >
        <div
          className="w-full max-w-sm rounded-lg border border-white/10 bg-neutral-900 p-5"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="mb-1 text-sm font-medium text-white/90">닉네임을 정해주세요</p>
          <p className="mb-3 text-xs text-white/40">
            공개한 재생목록은 이 닉네임으로 랭킹 피드에 표시돼요. 나중에 다시 정해서 바꿀 수도 있어요.
          </p>
          <input
            autoFocus
            value={nicknameInput}
            onChange={(e) => setNicknameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSetNickname();
            }}
            placeholder="2~20자"
            maxLength={20}
            className="mb-1 w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {nicknameError && <p className="mb-2 text-xs text-red-400">{nicknameError}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              disabled={isSavingNickname}
              onClick={() => {
                setIsNicknameModalOpen(false);
                setPendingVisibilityPlaylist(null);
                setPendingVisibilityCategory(null);
              }}
              className="rounded-md px-3 py-1.5 text-sm text-white/60 hover:bg-white/10 disabled:opacity-40"
            >
              취소
            </button>
            <button
              type="button"
              disabled={isSavingNickname || nicknameInput.trim().length < 2}
              onClick={handleSetNickname}
              className="rounded-md bg-accent px-3 py-1.5 text-sm text-black disabled:opacity-40"
            >
              {isSavingNickname ? "저장 중..." : "설정하고 공개하기"}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
