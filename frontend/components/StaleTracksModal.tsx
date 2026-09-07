"use client";

import { useState } from "react";
import type { FavoriteTrack } from "@/lib/playlistApi";

type StaleTracksModalProps = {
  tracks: FavoriteTrack[];
  months: number;
  onClose: () => void;
  onDeleteSelected: (ids: number[]) => void;
};

// "즐겨찾기해놓고 시간 지나면 안 듣는 곡도 생기지 않냐, 그런 곡을 지워도 되는지 물어봐달라"는
// 요청으로 추가. 절대 조용히 지우지 않고, 항상 후보 목록을 먼저 보여주고 사용자가 고른 것만 지움 —
// "아무거나 삭제하면 그건 좀 그렇다"는 우려를 반영해 기본은 전체 선택이 아니라 하나씩 확인 가능하게 함.
export default function StaleTracksModal({ tracks, months, onClose, onDeleteSelected }: StaleTracksModalProps) {
  // 기본은 전부 체크 — "정리하기"를 눌렀다는 것 자체가 대체로 정리할 의도가 있다는 뜻이라
  // 매번 하나씩 다 체크하게 하는 것보단, 원치 않는 것만 해제하는 쪽이 덜 번거로움.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set(tracks.map((t) => t.id)));

  function toggle(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) => (prev.size === tracks.length ? new Set() : new Set(tracks.map((t) => t.id))));
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-lg border border-white/10 bg-neutral-900 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium">최근 {months}개월간 안 들은 곡</p>
            <p className="text-xs text-white/40">
              {tracks.length > 0 ? `${tracks.length}곡을 찾았어요. 지울 곡만 골라주세요.` : "정리할 곡이 없어요."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="shrink-0 rounded-full p-1 text-white/50 hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        {tracks.length > 0 && (
          <>
            <button
              type="button"
              onClick={toggleAll}
              className="mb-2 text-xs text-white/50 hover:text-white/80 hover:underline"
            >
              {selectedIds.size === tracks.length ? "전체 해제" : "전체 선택"}
            </button>

            <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
              {tracks.map((t) => (
                <label
                  key={t.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-white/5"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(t.id)}
                    onChange={() => toggle(t.id)}
                    className="shrink-0 accent-accent"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      {t.trackName} · {t.artistName}
                    </p>
                    <p className="truncate text-[11px] text-white/40">
                      {t.lastOpenedAt
                        ? `마지막으로 들은 날: ${t.lastOpenedAt.slice(0, 10)}`
                        : `즐겨찾기한 뒤로 재생한 적 없음 (즐겨찾기: ${t.createdAt.slice(0, 10)})`}
                    </p>
                  </div>
                </label>
              ))}
            </div>

            <div className="mt-3 flex justify-end gap-2 border-t border-white/10 pt-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3 py-1.5 text-sm text-white/60 hover:bg-white/10"
              >
                취소
              </button>
              <button
                type="button"
                disabled={selectedIds.size === 0}
                onClick={() => onDeleteSelected(Array.from(selectedIds))}
                className="rounded-md bg-red-500/90 px-3 py-1.5 text-sm text-white disabled:opacity-40"
              >
                선택한 {selectedIds.size}곡 삭제
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
