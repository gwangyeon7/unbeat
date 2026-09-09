import { getSessionId } from "@/lib/session";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export type Artist = {
  name: string;
  mbid: string;
  image: string | null;
  listeners: string;
};

export type Track = {
  name: string;
  artist: string;
  listeners: string | null;
  url: string;
  image: string | null;
  // 유튜브 인기 급상승(getYoutubeChart) 트랙만 채워짐 — 이미 videoId를 알고 있어서
  // 재생 시 /youtube-search로 다시 검색할 필요가 없음(쿼터 절약).
  videoId?: string | null;
};

async function fetchJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      "X-Session-Id": getSessionId(),
      // ngrok 무료 티어는 브라우저 최초 방문 때뿐 아니라 이 fetch 같은 XHR 요청에도
      // "방문 확인" 경고 페이지(HTML)를 끼워 넣어서, res.json() 파싱이 깨져 조용히
      // 빈 배열로 폴백되는 문제가 있었음(폰으로 테스트할 때 홈 화면 전체가 비어 보인 원인).
      // 이 헤더를 보내면 ngrok이 그 경고를 건너뛰어줌 — 로컬/운영에서는 아무 영향 없음.
      "ngrok-skip-browser-warning": "true",
      ...options.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`API 요청 실패: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function searchArtist(artistName: string): Promise<{ artists: Artist[] }> {
  const query = encodeURIComponent(artistName);
  return fetchJson(`/search-artist?artist_name=${query}`);
}

// 아티스트 이름 + 곡 제목을 같이 검색 (검색창 통합 검색용). searchArtist는 아티스트 전용이라
// "노래 제목은 아는데 아티스트는 모르는" 상황을 못 다뤄서 새로 추가함.
// correctedArtistName: 아티스트 검색 결과가 없어서 Last.fm 오타 교정으로 재검색했을 때, 실제로 검색된 이름
// tagTracks: "2010년대 kpop"처럼 아티스트/곡 이름이 아니라 장르·연대 키워드로 검색했을 때
// Last.fm 태그 검색으로 보완한 결과 (정확한 매칭이 아니라 느슨한 "관련 곡" 목록)
// aiGuessedQuery: 위 교정들로도 결과가 없어서(§53) Claude Haiku가 추측한 검색어로 재검색해 찾은 경우,
// 그 추측 검색어. "댓댓"처럼 검색어와 실제 결과가 안 닮아서 사용자가 의아할 수 있어 이유를 보여주기 위함.
// youtubeFallbackUsed: Last.fm+AI 추측까지 다 실패해서(§59) 유튜브 자체 검색으로 찾은 경우 true —
// 이땐 tracks 맨 앞 항목이 Last.fm 정식 매칭이 아니라 청취자 수 등 메타데이터 없는 "비검증" 결과임.
export function search(query: string): Promise<{
  artists: Artist[];
  tracks: Track[];
  tagTracks: Track[];
  correctedArtistName: string | null;
  aiGuessedQuery: string | null;
  youtubeFallbackUsed: boolean;
}> {
  const q = encodeURIComponent(query);
  return fetchJson(`/search?q=${q}`);
}

// 검색창 자동완성용 — "numb"만 쳐도 "Numb Little Bug" 같은 후보가 뜨게 해달라는 요청으로 추가.
// /search와 달리 이미지가 없는 이름만 반환(속도 우선), SearchBar가 타이핑마다(디바운스) 호출함.
export type SearchSuggestion = { name: string; artist: string };

export function searchSuggest(query: string): Promise<{ tracks: SearchSuggestion[]; artists: string[] }> {
  const q = encodeURIComponent(query);
  return fetchJson(`/search-suggest?q=${q}`);
}

export function recommendByArtist(artistName: string): Promise<{ tracks: Track[] }> {
  const query = encodeURIComponent(artistName);
  return fetchJson(`/recommend?artist_name=${query}`);
}

// (§61) 검색 중 홈 화면 "지금 인기 있는 곡"/"인기 아티스트"를 검색과 무관한 고정 콘텐츠로 두지 말고
// 검색한 아티스트 본인의 다른 곡으로 채워달라는 요청으로 추가. recommendByArtist(/recommend)는
// "비슷한 아티스트들"의 곡이라 의도가 달라서 재사용하지 않고 분리된 엔드포인트를 씀.
export function getArtistTopTracks(artistName: string): Promise<{ tracks: Track[] }> {
  const query = encodeURIComponent(artistName);
  return fetchJson(`/artist-top-tracks?artist_name=${query}`);
}

// 아티스트 검색 없이, 무드/상황 태그만으로 인기곡을 가져옴 (홈 화면 탐색용)
// "한국 노래랑 팝송 구분하고 싶다"는 요청으로 국내/해외 두 목록으로 나눠서 옴.
export function discoverByMood(
  tag: string
): Promise<{ domesticTracks: Track[]; internationalTracks: Track[] }> {
  const query = encodeURIComponent(tag);
  return fetchJson(`/discover-by-mood?tag=${query}`);
}

// 검색창 드롭다운용 '최근 검색' 목록. 분석 이벤트 로그가 아니라 Redis에 세션별로 저장된
// UI 전용 목록이라 사용자가 개별 삭제 가능함 (removeRecentSearch).
export function getRecentSearches(): Promise<{ queries: string[] }> {
  return fetchJson(`/recent-searches`);
}

export function removeRecentSearch(query: string): Promise<{ removed: string }> {
  const q = encodeURIComponent(query);
  return fetchJson(`/recent-searches?q=${q}`, { method: "DELETE" });
}

// (§49) 홈 화면 "다시 듣기" 섹션용 최근 재생 기록. 사이드바 "즐겨찾기"와 데이터가 중복된다는
// 지적으로, 즐겨찾기 목록을 재사용하던 걸 진짜 재생 기록으로 교체 — /recent-searches와 같은
// 패턴(Redis 세션별 목록, 분석 이벤트 로그와 분리).
export function recordRecentPlay(
  artist: string,
  track: string,
  url?: string | null,
  image?: string | null
): Promise<{ recorded: boolean }> {
  return fetchJson(`/recent-plays`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ artist, track, url, image }),
  });
}

export function getRecentPlays(): Promise<{ tracks: Track[] }> {
  return fetchJson(`/recent-plays`);
}

// 홈 화면 중앙 기본 콘텐츠용 인기 차트 (Last.fm 전체/국가별 차트). 검색/무드 선택 없이도
// 항상 호출해서, 멜론/유튜브 뮤직처럼 첫 화면부터 곡이 채워져 보이게 함.
// country를 안 주면 글로벌 차트, 주면 그 나라 차트 (예: "south korea") — 홈 화면을
// 여러 행으로 나눠달라는 피드백 반영해 같은 엔드포인트를 국가 파라미터로 구분해서 재사용.
export function getTopChart(country?: string): Promise<{ tracks: Track[] }> {
  const q = country ? `?country=${encodeURIComponent(country)}` : "";
  return fetchJson(`/chart${q}`);
}

// 홈 화면 '인기 아티스트' 행용 — Last.fm 전체 서비스 인기 아티스트 랭킹
export function getTopArtists(): Promise<{ artists: Artist[] }> {
  return fetchJson(`/chart/artists`);
}

// 홈 화면 "인기 급상승" 섹션용 — Last.fm 대신 유튜브 실제 트렌딩(videos.list, chart=mostPopular)을
// 지역별로 가져옴. "유튜브 API를 연동해놓고 왜 재생 검색에만 쓰냐"는 피드백으로 추가.
export function getYoutubeChart(region: "KR" | "US"): Promise<{ tracks: Track[] }> {
  return fetchJson(`/youtube-chart?region=${region}`);
}

// (§73 후속) /youtube-search 호출 1번이 100유닛(하루 쿼터 10,000유닛)이라 꽤 비쌈. 같은
// 세션 안에서 같은 곡을 두 번 이상 검색하는 경우가 실제로 있음 — 예를 들어 화면 꺼짐 자동전환용
// "다음 몇 곡 미리보기"(MiniPlayer.tsx)가 미리 resolve해둔 곡을, 그 곡이 실제로 재생 시작될 때
// page.tsx의 handlePlay가 또 검색하는 식. 세션 메모리에 캐싱해서 같은 곡 재검색을 없앰(0유닛으로
// 재사용). 새로고침하면 비워지는 휘발성 캐시라 유튜브 결과가 실제로 바뀌어도 다음 방문에 다시 반영됨.
const youtubeVideoIdCache = new Map<string, string | null>();
function youtubeCacheKey(artist: string, track: string): string {
  return `${artist.toLowerCase().trim()}::${track.toLowerCase().trim()}`;
}

// 트랙 카드를 누르면 Last.fm 자체 페이지로 나가는 대신, 사이트 안 하단 미니 플레이어에서
// 바로 재생되게 하려고 유튜브에서 이 곡의 videoId를 찾음. 못 찾으면 videoId: null.
export async function searchYoutubeVideo(
  artist: string,
  track: string
): Promise<{ videoId: string | null }> {
  const key = youtubeCacheKey(artist, track);
  if (youtubeVideoIdCache.has(key)) {
    return { videoId: youtubeVideoIdCache.get(key) ?? null };
  }
  const params = new URLSearchParams({ artist, track });
  const result = await fetchJson<{ videoId: string | null }>(`/youtube-search?${params.toString()}`);
  youtubeVideoIdCache.set(key, result.videoId ?? null);
  return result;
}

// 미니 플레이어 "다음 트랙" 큐용 — 지금 재생 중인 곡과 비슷한 곡 목록.
// 유튜브 뮤직처럼 곡이 끝나면 자동으로 비슷한 곡이 이어 재생되게 하려고 추가.
export function getSimilarTracks(artist: string, track: string): Promise<{ tracks: Track[] }> {
  const params = new URLSearchParams({ artist, track });
  return fetchJson(`/similar-tracks?${params.toString()}`);
}

export type LyricsResult = {
  found: boolean;
  syncedLyrics: string | null;
  plainLyrics: string | null;
  // 저작권자 삭제 요청으로 내려간 곡이면 백엔드가 이 값을 true로 채워서, "아직 못 찾은 곡"과
  // "의도적으로 내린 곡"을 가사 탭에서 다르게 안내할 수 있게 함(§44).
  takenDown?: boolean;
};

// 확장 재생 화면 "가사" 탭용. Genius/YouTube 둘 다 가사 원문을 못 줘서 보류했던 기능인데,
// LRCLIB(lrclib.net)이 API 키 없이 무료로 크라우드소싱 가사를 제공한다는 걸 확인하고 붙임.
export function getLyrics(artist: string, track: string): Promise<LyricsResult> {
  const params = new URLSearchParams({ artist, track });
  return fetchJson(`/lyrics?${params.toString()}`);
}

// 가사 탭에서 가사를 못 찾았을 때 "가사 올려주세요" 버튼용. 즉시 가사가 생기진 않고,
// 요청을 이벤트 로그로 남겨서 나중에 운영자가 직접 확인 후 수동으로 등록(/lyrics/override)함.
export function requestLyrics(artist: string, track: string): Promise<{ requested: boolean }> {
  const params = new URLSearchParams({ artist, track });
  return fetchJson(`/lyrics/request?${params.toString()}`, { method: "POST" });
}

export type LyricsRequestItem = {
  artist: string;
  track: string;
  requestCount: number;
  lastRequestedAt: string | null;
};

// 가사 관리자 화면(/admin/lyrics)용 — "가사 올려주세요"로 쌓인 요청 중 아직 처리 안 된 것만.
// ADMIN_SECRET을 X-Admin-Secret 헤더로 보내야 함(없거나 틀리면 백엔드가 403).
export function getLyricsRequests(adminSecret: string): Promise<{ requests: LyricsRequestItem[] }> {
  return fetchJson(`/admin/lyrics-requests`, {
    headers: { "X-Admin-Secret": adminSecret },
  });
}

// 가사 관리자 화면에서 직접 구한 가사를 등록. 가사 본문이 길어서(수백~수천자) 쿼리 파라미터가
// 아니라 JSON 바디로 보냄 — URL 길이 제한에 걸리는 걸 피하려고 백엔드도 이 형태로 맞춰둠.
export function submitLyricsOverride(
  adminSecret: string,
  payload: { artist: string; track: string; plain_lyrics: string; synced_lyrics?: string }
): Promise<{ found: boolean }> {
  return fetchJson(`/lyrics/override`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Secret": adminSecret },
    body: JSON.stringify(payload),
  });
}

// 저작권자(또는 대리인)가 실제로 삭제를 요청했을 때 쓰는 관리자 전용 기능(§44). 호출하면 해당
// 곡은 override든 LRCLIB/lyrics.ovh 자동 폴백이든 상관없이 영구히 "가사 없음"으로 취급됨.
export function takedownLyrics(
  adminSecret: string,
  payload: { artist: string; track: string }
): Promise<{ takenDown: boolean }> {
  return fetchJson(`/admin/lyrics/takedown`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Secret": adminSecret },
    body: JSON.stringify(payload),
  });
}

// "빠른 선곡" 홈 섹션용 — 즐겨찾기 전체를 Claude Haiku 4.5에게 보여주고 새 곡을 추천받음
// (기존 artist.getSimilar 기반 방식보다 취향을 더 폭넓게 반영). 이 프로젝트 첫 유료 API라
// 백엔드에 ANTHROPIC_API_KEY가 없으면 503이 나는데, 그 경우 호출한 쪽에서 기존 방식으로
// 폴백하는 걸 전제로 함(page.tsx의 quickPickTracks 로직 참고).
export function getAiQuickPicks(
  favorites: { artist: string; name: string }[]
): Promise<{ tracks: Track[] }> {
  return fetchJson(`/quick-picks/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ favorites }),
  });
}
