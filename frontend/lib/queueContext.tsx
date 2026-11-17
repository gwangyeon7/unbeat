"use client";

import { createContext, useContext } from "react";

// 곡 ⋮ 메뉴의 "다음에 재생" / "대기열에 추가"를 모든 곡 목록에서 똑같이 쓰게 하는 연결선.
// page.tsx가 한 번 제공하면 CompactTrackRow가 알아서 메뉴에 항목을 보여줌(곡 목록마다 props를
// 일일이 내려주지 않아도 됨). 제공자가 없는 화면에서는 항목이 안 보임.
export type QueueTrackInfo = { name: string; artist: string; image?: string | null };

export type QueueActions = {
  playNext: (track: QueueTrackInfo) => void;
  addToQueue: (track: QueueTrackInfo) => void;
};

export const QueueActionsContext = createContext<QueueActions | null>(null);

export function useQueueActions(): QueueActions | null {
  return useContext(QueueActionsContext);
}
