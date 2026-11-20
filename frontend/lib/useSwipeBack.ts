import { useRef } from "react";

// 전체화면 위에 뜨는 화면(뒤로가기 버튼이 있는 화면)에서 왼쪽 가장자리를 오른쪽으로 쓸면 뒤로 가기.
// 가로 스크롤 목록·슬라이더와 안 겹치게 왼쪽 60px에서 시작한 제스처만 인정하고,
// 세로로 많이 움직인 건(스크롤) 무시함. 반환값을 화면 최상위 div에 펼쳐서 쓰면 됨.
export function useSwipeBack(onBack: () => void) {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      startRef.current = t.clientX <= 60 ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const start = startRef.current;
      startRef.current = null;
      if (!start) return;
      const t = e.changedTouches[0];
      if (t.clientX - start.x > 70 && Math.abs(t.clientY - start.y) < 60) onBack();
    },
  };
}
