import { getSessionId } from "@/lib/session";

// FastAPI 백엔드(api.ts)와 별도 서비스. 포트도 다르고(8081), 언어/프레임워크도 다르다
// (Spring Boot/Kotlin). 대신 세션 식별 방식(X-Session-Id)만은 동일하게 맞춘다.
const PLAYLIST_API_BASE_URL =
  process.env.NEXT_PUBLIC_PLAYLIST_API_URL ?? "http://127.0.0.1:8081";

export type Favorite = {
  id: number;
  artistName: string;
  imageUrl: string | null;
  createdAt: string;
};

async function playlistFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${PLAYLIST_API_BASE_URL}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      "X-Session-Id": getSessionId(),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`즐겨찾기 API 요청 실패: ${res.status}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export function getFavorites(): Promise<Favorite[]> {
  return playlistFetch<Favorite[]>("/favorites");
}

export function addFavorite(artistName: string, imageUrl: string | null): Promise<Favorite> {
  return playlistFetch<Favorite>("/favorites", {
    method: "POST",
    body: JSON.stringify({ artistName, imageUrl }),
  });
}

export function removeFavorite(id: number): Promise<void> {
  return playlistFetch<void>(`/favorites/${id}`, { method: "DELETE" });
}
