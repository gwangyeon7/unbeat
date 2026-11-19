// 곡/아티스트 표지 이미지를 화면에 그릴 크기에 맞춰 작게 받는 도우미.
// 카탈로그/외부 소스가 500x500짜리 원본 주소를 주는데, 48px 썸네일에도 그대로 받으면 느린 폰에서 목록이 늦게 뜸.
// Deezer(.../500x500-000000-80-0-0.jpg)와 iTunes(.../100x100bb.jpg)는 주소의 크기 숫자만 바꾸면 작은 이미지를 줌.
// 모르는 주소(유튜브 썸네일 등)는 그대로 돌려줌 — 실패해도 원래 이미지가 나오게.
export function thumbUrl(url: string | null | undefined, px: number): string | null | undefined {
  if (!url) return url;
  try {
    if (url.includes("dzcdn.net/")) {
      return url.replace(/\/(\d{2,4})x\1-/, `/${px}x${px}-`);
    }
    if (url.includes("mzstatic.com/")) {
      return url.replace(/\/\d{2,4}x\d{2,4}(bb)?\.(jpg|png|webp)/, `/${px}x${px}$1.$2`);
    }
  } catch {
    // 아래에서 원본 반환
  }
  return url;
}
