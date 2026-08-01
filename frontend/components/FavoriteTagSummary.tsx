type FavoriteTagSummaryProps = {
  tracksByTag: Record<string, { id: number }[]>;
};

// 태그마다 색을 고정 배정 — 같은 태그는 "다시 듣기" 섹션과 색 느낌이 이어지게(굳이 완전히
// 똑같은 컴포넌트를 쓰진 않지만, 최소한 "이 페이지의 다른 곳과 같은 언어를 쓰는" 느낌을 주기 위함).
const TAG_COLORS = [
  "bg-rose-400",
  "bg-amber-400",
  "bg-emerald-400",
  "bg-sky-400",
  "bg-violet-400",
  "bg-pink-400",
];

function colorForTag(tag: string) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) % TAG_COLORS.length;
  return TAG_COLORS[hash];
}

// 오른쪽 사이드바 위젯. 이미 "다시 듣기" 섹션에서 태그별로 묶어둔 데이터를
// 그대로 재사용해서 개수만 요약해서 보여줌 — 새 계산/저장 없음.
// 메인 카드와 같은 border + bg-white/5 스타일을 써서 사이드바가 따로 노는 느낌을 줄임.
export default function FavoriteTagSummary({ tracksByTag }: FavoriteTagSummaryProps) {
  const entries = Object.entries(tracksByTag).sort((a, b) => b[1].length - a[1].length);

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white/30">
        곡을 즐겨찾기하면 태그별 요약이 여기 쌓여요.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {entries.map(([tag, tracksInTag]) => (
        <li
          key={tag}
          className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 p-2.5"
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${colorForTag(tag)}`} />
            <span className="truncate text-xs uppercase tracking-wide text-white/70">{tag}</span>
          </span>
          <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/50">
            {tracksInTag.length}곡
          </span>
        </li>
      ))}
    </ul>
  );
}
