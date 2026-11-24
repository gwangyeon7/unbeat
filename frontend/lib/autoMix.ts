import { getMixPool, type Track } from "@/lib/api";
import type { AutoMixTrack, FavoriteTrack } from "@/lib/playlistApi";

// (2026-11-24) 후보를 별칭표에서 한 번에 받아 옴(/mix-pool) — 예전엔 차트·무드·아티스트 인기곡 호출 10여 개를 동시에 보내
// 캐시가 비면 10초 가까이 걸려서 시연에 불안했음. 별칭표는 서버 메모리라 거의 즉시 응답하고 유튜브 쿼터도 안 씀.
// (아래 설명은 예전 방식 기준) "오늘의 믹스" 후보 풀 만들기 + 곡 고르기. 즐겨찾기만 섞으면 즐겨찾기가 적을 때 곡이 몇 개 안 되고
// 누를 때마다 같은 곡만 순서만 바뀌어서, 즐겨찾기 아티스트 인기곡 + 인기 차트(국내/글로벌)를 늘 같이
// 풀에 넣고 거기서 무작위로 고름. 유튜브 쿼터를 쓰지 않도록 Last.fm 기반 API만 씀.
// 비슷한 곡(/similar-tracks)은 캐시가 없을 때 느리고(15초 가까이) 한국 곡이 적으며, 결과가 비면
// Claude 폴백 비용까지 생겨서 믹스에서는 쓰지 않음.

const MIX_SIZE = 30;
// (2026-11-22) 국내:해외 = 5:5 — 한국 사용자가 쓰는데 Last.fm 차트가 해외곡 위주라 믹스 맨 위가 팝송으로 채워지던 문제.
// 국내 곡은 감성 무드(잔잔한/출퇴근길/위로/슬픔/설렘/신나는)에 직접 골라 둔 곡 목록에서 가져옴(인디·발라드·유명곡 위주).
const DOMESTIC_TARGET = MIX_SIZE / 2;
const INTERNATIONAL_TARGET = MIX_SIZE - DOMESTIC_TARGET;
const MUST_INCLUDE_FAVORITES = 5; // 보관함에 담은 곡이 믹스에 보이게 즐겨찾기 중 최대 5곡은 반드시 넣음
const MAX_PER_ARTIST = 6; // 한 아티스트로 쏠리지 않게(즐겨찾기 아티스트가 1명이어도 나머지는 차트 곡으로 채워짐)
const MIN_MIX_TRACKS = 10; // 이보다 적게 모이면 호출하는 쪽이 /playlists/auto-generate로 폴백
// 전체 마감 — 이 안에 온 결과만으로 믹스를 만듦(캐시된 호출은 거의 0초라 대부분 금방 끝남)
const POOL_TIMEOUT_MS = 6000;

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

export type AutoMixResult = {
  tracks: AutoMixTrack[];
  // false면 즐겨찾기가 없어서 인기곡으로만 만든 믹스
  fromFavorites: boolean;
};

// 모인 곡이 MIN_MIX_TRACKS 미만이면 null — 호출하는 쪽이 기존 /playlists/auto-generate(즐겨찾기만 섞기)로 폴백
export async function buildAutoMix(favorites: FavoriteTrack[]): Promise<AutoMixResult | null> {
  const fromFavorites = favorites.length > 0;
  const favoriteTracks = shuffle(favorites.map(fromFavorite));

  // 별칭표에서 국내/해외 후보를 받음(실패하거나 6초 안에 못 받으면 null -> 호출하는 쪽이 기존 방식으로 폴백)
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pool = await Promise.race([
      getMixPool(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), POOL_TIMEOUT_MS);
      }),
    ]);
    const picked = pick(
      favoriteTracks,
      [],
      pool.domesticTracks.map(fromTrack),
      pool.internationalTracks.map(fromTrack)
    );
    if (picked.length < MIN_MIX_TRACKS) return null;
    return { tracks: picked, fromFavorites };
  } catch {
    return null;
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
