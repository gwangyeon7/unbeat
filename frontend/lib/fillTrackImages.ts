import { getTrackImage } from "@/lib/api";

// 보관함의 즐겨찾기/재생목록 곡 중 이미지 없이 저장된 곡의 커버를, 그 목록을 열 때 서버에 물어서 채움.
// 한 번에 너무 많이 부르지 않게 5곡씩 끊어서 차례로 처리함.
const BATCH_SIZE = 5;

// 이 탭에서 이미 물어본 곡 — 못 찾은 곡을 목록이 다시 그려질 때마다 계속 묻지 않게 함.
// 시작할 때 대상 전체를 미리 넣어둬서, 처리 중에 목록이 바뀌어 다시 호출돼도 같은 곡을 중복으로 안 부름.
const attempted = new Set<string>();

export async function fillMissingTrackImages<T>(
  items: T[],
  opts: {
    keyOf: (item: T) => string;
    artistOf: (item: T) => string;
    trackOf: (item: T) => string;
    onFound: (item: T, imageUrl: string) => void;
  }
): Promise<void> {
  const targets = items.filter((item) => !attempted.has(opts.keyOf(item)));
  targets.forEach((item) => attempted.add(opts.keyOf(item)));

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    await Promise.all(
      targets.slice(i, i + BATCH_SIZE).map(async (item) => {
        try {
          const { image } = await getTrackImage(opts.artistOf(item), opts.trackOf(item));
          if (image) opts.onFound(item, image);
        } catch {
          // 이미지 보완은 부가 기능 — 실패해도 목록 자체는 그대로 보여줌
        }
      })
    );
  }
}
