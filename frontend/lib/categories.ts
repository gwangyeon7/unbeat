// 랭킹 피드 카테고리(2026-10-10 추가) — playlist-service의 MUSIC_CATEGORIES(Kotlin)와
// 값을 똑같이 맞춰야 함. 공개 전환 시 이 중 하나를 선택해야 하고(공개 전환 "전"이 아니라
// "그 순간"에만 물어봄 — 닉네임과 같은 논리, 재생목록 만들 때는 장벽이 생기면 안 되니까),
// 랭킹 피드 상단 필터 칩도 이 목록을 그대로 씀.
export const MUSIC_CATEGORIES: { value: string; label: string }[] = [
  { value: "kpop", label: "케이팝" },
  { value: "ballad", label: "발라드" },
  { value: "hiphop", label: "힙합" },
  { value: "rnb", label: "알앤비" },
  { value: "rock", label: "록" },
  { value: "pop", label: "팝" },
  { value: "indie", label: "인디" },
  { value: "electronic", label: "일렉트로닉" },
  { value: "acoustic", label: "어쿠스틱" },
  { value: "jazz", label: "재즈" },
  { value: "classical", label: "클래식" },
  { value: "ost", label: "OST" },
  { value: "etc", label: "기타" },
];
