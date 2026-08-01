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
};

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    cache: "no-store",
    headers: {
      "X-Session-Id": getSessionId(),
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
export function search(
  query: string
): Promise<{ artists: Artist[]; tracks: Track[]; correctedArtistName: string | null }> {
  const q = encodeURIComponent(query);
  return fetchJson(`/search?q=${q}`);
}

export function recommendByArtist(artistName: string): Promise<{ tracks: Track[] }> {
  const query = encodeURIComponent(artistName);
  return fetchJson(`/recommend?artist_name=${query}`);
}

// 아티스트 검색 없이, 무드/상황 태그만으로 인기곡을 가져옴 (홈 화면 탐색용)
export function discoverByMood(tag: string): Promise<{ tracks: Track[] }> {
  const query = encodeURIComponent(tag);
  return fetchJson(`/discover-by-mood?tag=${query}`);
}

export type RecentSearchArtist = {
  name: string;
  image: string | null;
};

// 사이드바 '최근 검색' 위젯용. 이 세션이 최근 검색한 아티스트명 목록(최신순, 중복 없음) + 썸네일
export function getRecentSearches(): Promise<{ artists: RecentSearchArtist[] }> {
  return fetchJson(`/recent-searches`);
}
