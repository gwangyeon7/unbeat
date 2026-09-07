// 유튜브 뮤직 홈 화면의 "운동/휴식/집중" 같은 무드 칩을 흉내냄.
// 라벨은 한국어로 보여주고, 실제 조회는 Last.fm에 있는 영문 태그로 함.
export const MOODS = [
  { label: "운동", tag: "workout" },
  { label: "휴식", tag: "chill" },
  { label: "집중", tag: "study" },
  { label: "신나는", tag: "party" },
  { label: "잔잔한", tag: "mellow" },
  { label: "슬픔", tag: "sad" },
  { label: "로맨스", tag: "love" },
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
    <div className="flex w-full max-w-xl gap-2 overflow-x-auto pb-1">
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
