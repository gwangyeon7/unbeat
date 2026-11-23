import { discoverByMood, getArtistTopTracks, getTopArtists, getTopChart, type Track } from "@/lib/api";
import type { AutoMixTrack, FavoriteTrack } from "@/lib/playlistApi";

// "오늘의 믹스" 후보 풀 만들기 + 곡 고르기. 즐겨찾기만 섞으면 즐겨찾기가 적을 때 곡이 몇 개 안 되고
// 누를 때마다 같은 곡만 순서만 바뀌어서, 즐겨찾기 아티스트 인기곡 + 인기 차트(국내/글로벌)를 늘 같이
// 풀에 넣고 거기서 무작위로 고름. 유튜브 쿼터를 쓰지 않도록 Last.fm 기반 API만 씀.
// 비슷한 곡(/similar-tracks)은 캐시가 없을 때 느리고(15초 가까이) 한국 곡이 적으며, 결과가 비면
// Claude 폴백 비용까지 생겨서 믹스에서는 쓰지 않음.

const MIX_SIZE = 30;
// (2026-11-22) 국내:해외 = 5:5 — 한국 사용자가 쓰는데 Last.fm 차트가 해외곡 위주라 믹스 맨 위가 팝송으로 채워지던 문제.
// 국내 곡은 감성 무드(잔잔한/출퇴근길/위로/슬픔/설렘/신나는)에 직접 골라 둔 곡 목록에서 가져옴(인디·발라드·유명곡 위주).
const DOMESTIC_TARGET = MIX_SIZE / 2;
const INTERNATIONAL_TARGET = MIX_SIZE - DOMESTIC_TARGET;
const MOOD_TAGS = ["chill", "driving", "study", "sad", "love", "party"];
const MOOD_CALLS = 4; // 무드 중 무작위 4개를 골라 조회(서버에 미리 만들어 둔 곡 풀이라 빠름)
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

// 한글이 들어간 이름이면 국내 곡으로 봄(BTS/aespa처럼 영문 이름 가수는 무드 조회 결과의 국내/해외 구분을 우선 씀)
const hasHangul = (t: AutoMixTrack) => /[가-힣]/.test(`${t.artistName}${t.trackName}`);

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
    // + 감성 무드 곡 풀(국내 곡을 확실히 채우기 위함)
    const moodTags = shuffle(MOOD_TAGS).slice(0, MOOD_CALLS);
    const [trackLists, artistLists, moodLists] = await Promise.all([
      settle(
        [...seedArtists.map(topTracksOf), getTopChart(KOREA_CHART_COUNTRY), getTopChart()],
        deadline
      ),
      settle([getTopArtists()], deadline),
      settle(moodTags.map((tag) => discoverByMood(tag)), deadline),
    ]);
    const moodDomestic = moodLists.flatMap((r) => r.domesticTracks.map(fromTrack));
    const moodInternational = moodLists.flatMap((r) => r.internationalTracks.map(fromTrack));
    let fetched = trackLists.flatMap((r) => r.tracks.map(fromTrack));
    let picked = pick(favoriteTracks, fetched, moodDomestic, moodInternational);

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
      picked = pick(favoriteTracks, fetched, moodDomestic, moodInternational);
    }

    if (picked.length < MIN_MIX_TRACKS) return null;
    return { tracks: picked, fromFavorites };
  } finally {
    clearTimeout(timer);
  }
}

// 즐겨찾기 최대 5곡은 반드시 넣고, 나머지는 국내 15 : 해외 15로 채움(아티스트당 6곡, 중복 제외).
// 한쪽 풀이 모자라면 남는 자리는 다른 쪽에서 채워 30곡을 유지하고, 결과는 국내/해외를 번갈아 배치해 맨 위부터 섞여 보이게 함.
function pick(
  favoriteTracks: AutoMixTrack[],
  fetched: AutoMixTrack[],
  moodDomestic: AutoMixTrack[],
  moodInternational: AutoMixTrack[]
): AutoMixTrack[] {
  const domestic: AutoMixTrack[] = [];
  const international: AutoMixTrack[] = [];
  const seen = new Set<string>();
  const perArtist = new Map<string, number>();
  const total = () => domestic.length + international.length;
  const canAdd = (t: AutoMixTrack) => {
    if (total() >= MIX_SIZE || !t.artistName || !t.trackName) return false;
    return !seen.has(trackKey(t)) && (perArtist.get(norm(t.artistName)) ?? 0) < MAX_PER_ARTIST;
  };
  const add = (t: AutoMixTrack, isDomestic: boolean) => {
    seen.add(trackKey(t));
    perArtist.set(norm(t.artistName), (perArtist.get(norm(t.artistName)) ?? 0) + 1);
    (isDomestic ? domestic : international).push(t);
  };

  // 1) 보관함에 담은 곡 중 최대 5곡은 반드시(국내/해외는 이름으로 판별)
  favoriteTracks.slice(0, MUST_INCLUDE_FAVORITES).forEach((t) => canAdd(t) && add(t, hasHangul(t)));

  // 2) 쿼터 채우기: 국내는 무드 곡(+즐겨찾기/차트 중 한글 곡), 해외는 차트·무드 해외곡(+영문 즐겨찾기)
  const rest = [...favoriteTracks.slice(MUST_INCLUDE_FAVORITES), ...fetched];
  const domesticPool = shuffle([...moodDomestic, ...rest.filter(hasHangul)]);
  const internationalPool = shuffle([...moodInternational, ...rest.filter((t) => !hasHangul(t))]);
  for (const t of domesticPool) {
    if (domestic.length >= DOMESTIC_TARGET) break;
    if (canAdd(t)) add(t, true);
  }
  for (const t of internationalPool) {
    if (international.length >= INTERNATIONAL_TARGET) break;
    if (canAdd(t)) add(t, false);
  }
  // 3) 한쪽이 모자라면 남은 풀에서 가리지 않고 채움
  for (const t of shuffle([...domesticPool, ...internationalPool])) {
    if (total() >= MIX_SIZE) break;
    if (canAdd(t)) add(t, domesticPool.includes(t));
  }

  // 4) 국내/해외를 번갈아 배치
  const d = shuffle(domestic);
  const intl = shuffle(international);
  const woven: AutoMixTrack[] = [];
  for (let i = 0; i < Math.max(d.length, intl.length); i++) {
    if (i < d.length) woven.push(d[i]);
    if (i < intl.length) woven.push(intl[i]);
  }
  return woven;
}
