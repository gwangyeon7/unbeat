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
  listeners: string;
  url: string;
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

export function recommendByArtist(artistName: string): Promise<{ tracks: Track[] }> {
  const query = encodeURIComponent(artistName);
  return fetchJson(`/recommend?artist_name=${query}`);
}
