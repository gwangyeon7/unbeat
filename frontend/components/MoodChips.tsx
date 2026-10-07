// 유튜브 뮤직 홈 화면의 "운동/휴식/집중" 같은 무드 칩을 흉내냄.
// 라벨은 한국어로 보여주고, 실제 조회는 Last.fm에 있는 영문 태그로 함.
//
// (2026-10-06) 8개 중 로맨스/휴식/집중/잔잔한 4개를 뺌 — "휴식에 신나는 곡이 섞여 나오기도
// 하고, 집중/휴식/잔잔한처럼 경계가 모호한 무드가 많다"는 피드백. 운동/신나는/슬픔/출퇴근길처럼
// 상황이 명확한 무드만 남김. 뺀 4개의 백엔드 큐레이션 목록(main.py CURATED_DOMESTIC_MOOD_TRACKS)은
// 그대로 둠 — 호출 자체가 안 되니 무해하고, 특히 mellow는 오늘 20곡으로 늘린 작업이라 나중에
// 다른 기능(예: AI 보컬곡 모음 등)에 재활용할 가능성을 열어둠.
export const MOODS = [
  { label: "운동", tag: "workout" },
  { label: "신나는", tag: "party" },
  { label: "슬픔", tag: "sad" },
  { label: "출퇴근길", tag: "driving" },
] as const;

type MoodChipsProps = {
  selectedTag: string | null;
  onSelect: (tag: string) => void;
};

export default function MoodChips({ selectedTag, onSelect }: MoodChipsProps) {
  return (
    // flex-wrap이었을 때 칩 8개가 한 줄에 다 안 들어가서 마지막("출퇴근길") 하나만 다음 줄에
    // 외로이 떨어지는 게 어색하다는 피드백 -> 유튜브 뮤직처럼 한 줄 가로 스크롤로 변경
    <div className="scrollbar-none flex w-full max-w-xl gap-2 overflow-x-auto pb-1">
      {MOODS.map((mood) => (
        <button
          key={mood.tag}
          onClick={() => onSelect(mood.tag)}
          className={`shrink-0 rounded-full border px-4 py-2 text-sm transition ${
            selectedTag === mood.tag
              ? "border-accent bg-accent/10 text-accent"
              : "border-white/10 bg-white/5 hover:border-white/30"
          }`}
        >
          {mood.label}
        </button>
      ))}
    </div>
  );
}
