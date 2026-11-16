import { getArtistTopTracks, getTopArtists, getTopChart, type Track } from "@/lib/api";
import type { AutoMixTrack, FavoriteTrack } from "@/lib/playlistApi";

// "오늘의 믹스" 후보 풀 만들기 + 곡 고르기. 즐겨찾기만 섞으면 즐겨찾기가 적을 때 곡이 몇 개 안 되고
// 누를 때마다 같은 곡만 순서만 바뀌어서, 즐겨찾기 아티스트 인기곡 + 인기 차트(국내/글로벌)를 늘 같이
// 풀에 넣고 거기서 무작위로 고름. 유튜브 쿼터를 쓰지 않도록 Last.fm 기반 API만 씀.
// 비슷한 곡(/similar-tracks)은 캐시가 없을 때 느리고(15초 가까이) 한국 곡이 적으며, 결과가 비면
// Claude 폴백 비용까지 생겨서 믹스에서는 쓰지 않음.

const MIX_SIZE = 30;
const MUST_INCLUDE_FAVORITES = 5; // 보관함에 담은 곡이 믹스에 보이게 즐겨찾기 중 최대 5곡은 반드시 넣음
const MAX_PER_ARTIST = 6; // 한 아티스트로 쏠리지 않게(즐겨찾기 아티스트가 1명이어도 나머지는 차트 곡으로 채워짐)
const MIN_MIX_TRACKS = 10; // 이보다 적게 모이면 호출하는 쪽이 /playlists/auto-generate로 폴백
const SEED_ARTISTS = 5; // 인기곡을 가져올 즐겨찾기 아티스트 수
// 2단계: 1단계로 30곡이 안 차면 차트에 나온 아티스트 중 무작위로 골라 인기곡을 더 가져옴
const EXPAND_ARTISTS = 4;
// 전체 마감 — 이 안에 온 결과만으로 믹스를 만듦(캐시된 호출은 거의 0초라 대부분 금방 끝남)
const POOL_TIMEOUT_MS = 6000;
// Last.fm geo.getTopTracks는 ISO 코드("KR")가 아니라 나라 이름을 받음("KR"이면 400)
const KOREA_CHART_COUNTRY = "Korea, Republic of";

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const norm = (s: string) => s.trim().toLowerCase();
const trackKey = (t: AutoMixTrack) => `${norm(t.artistName)}|${norm(t.trackName)}`;

function fromTrack(t: Track): AutoMixTrack {
  return { artistName: t.artist, trackName: t.name, url: t.url || null, imageUrl: t.image };
}

function fromFavorite(f: FavoriteTrack): AutoMixTrack {
  return { artistName: f.artistName, trackName: f.trackName, url: f.url, imageUrl: f.imageUrl };
}

const uniqueArtists = (names: string[]) => Array.from(new Map(names.map((n) => [norm(n), n])).values());

// 호출들을 동시에 보내고, 마감 안에 끝난 것만 씀(실패/시간 초과는 무시)
async function settle<T>(calls: Promise<T>[], deadline: Promise<never>): Promise<T[]> {
  const results = await Promise.allSettled(calls.map((c) => Promise.race([c, deadline])));
  const out: T[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") out.push(r.value as T);
  }
  return out;
}

const topTracksOf = (artist: string) => getArtistTopTracks(artist, { limit: 10, lyricsOnly: false });

export type AutoMixResult = {
  tracks: AutoMixTrack[];
  // false면 즐겨찾기가 없어서 인기곡으로만 만든 믹스
  fromFavorites: boolean;
};

// 모인 곡이 MIN_MIX_TRACKS 미만이면 null — 호출하는 쪽이 기존 /playlists/auto-generate(즐겨찾기만 섞기)로 폴백
export async function buildAutoMix(favorites: FavoriteTrack[]): Promise<AutoMixResult | null> {
  const fromFavorites = favorites.length > 0;
  const favoriteTracks = shuffle(favorites.map(fromFavorite));
  const seedArtists = shuffle(uniqueArtists(favoriteTracks.map((t) => t.artistName))).slice(0, SEED_ARTISTS);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new Error("timeout"));
    }, POOL_TIMEOUT_MS);
  });

  try {
    // 1단계(전부 동시에): 즐겨찾기 아티스트 인기곡 + 국내/글로벌 인기 차트 + 인기 아티스트 목록(2단계용)
    const [trackLists, artistLists] = await Promise.all([
      settle(
        [...seedArtists.map(topTracksOf), getTopChart(KOREA_CHART_COUNTRY), getTopChart()],
        deadline
      ),
      settle([getTopArtists()], deadline),
    ]);
    let fetched = trackLists.flatMap((r) => r.tracks.map(fromTrack));
    let picked = pick(favoriteTracks, fetched);

    // 2단계: 30곡이 안 차면 차트/인기 아티스트 중 아직 안 쓴 아티스트 4명의 인기곡으로 채움.
    // 1단계가 마감 안에 다 모이지 않았으면(시간이 없으니) 건너뜀.
    if (picked.length < MIX_SIZE && !expired) {
      const used = new Set(seedArtists.map(norm));
      const candidates = uniqueArtists([
        ...fetched.map((t) => t.artistName),
        ...artistLists.flatMap((r) => r.artists.map((a) => a.name)),
      ]).filter((a) => !used.has(norm(a)));
      const more = await settle(shuffle(candidates).slice(0, EXPAND_ARTISTS).map(topTracksOf), deadline);
      fetched = [...fetched, ...more.flatMap((r) => r.tracks.map(fromTrack))];
      picked = pick(favoriteTracks, fetched);
    }

    if (picked.length < MIN_MIX_TRACKS) return null;
    return { tracks: shuffle(picked), fromFavorites };
  } finally {
    clearTimeout(timer);
  }
}

// 즐겨찾기 최대 5곡은 반드시 넣고, 나머지는 풀에서 무작위로 30곡까지(아티스트당 6곡, 중복 제외)
function pick(favoriteTracks: AutoMixTrack[], fetched: AutoMixTrack[]): AutoMixTrack[] {
  const picked: AutoMixTrack[] = [];
  const seen = new Set<string>();
  const perArtist = new Map<string, number>();
  const tryAdd = (t: AutoMixTrack) => {
    if (picked.length >= MIX_SIZE || !t.artistName || !t.trackName) return;
    const key = trackKey(t);
    const artist = norm(t.artistName);
    if (seen.has(key) || (perArtist.get(artist) ?? 0) >= MAX_PER_ARTIST) return;
    seen.add(key);
    perArtist.set(artist, (perArtist.get(artist) ?? 0) + 1);
    picked.push(t);
  };

  favoriteTracks.slice(0, MUST_INCLUDE_FAVORITES).forEach(tryAdd);
  // 나머지 즐겨찾기 + 가져온 곡을 한 풀로 섞어서 30곡이 될 때까지 채움
  shuffle([...favoriteTracks.slice(MUST_INCLUDE_FAVORITES), ...fetched]).forEach(tryAdd);
  return picked;
}
