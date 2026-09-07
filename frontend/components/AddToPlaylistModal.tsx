"use client";

import { useState } from "react";
import type { Playlist } from "@/lib/playlistApi";

type PendingTrack = {
  name: string;
  artist: string;
  image?: string | null;
};

type AddToPlaylistModalProps = {
  // 트랙 카드에서 "+"를 누르면 1개, 재생목록 상세 화면에서 여러 곡을 체크하고 "담기"를 누르면
  // 여러 개 — 항상 배열로 받아서 단일/일괄 추가를 같은 모달·같은 핸들러로 처리함.
  tracks: PendingTrack[];
  playlists: Playlist[];
  onClose: () => void;
  onAddToPlaylist: (playlistId: number) => void;
  onCreatePlaylist: (name: string) => void;
};

// 트랙 카드/즐겨찾기 목록 어디서든 "+" 버튼을 누르면 뜨는 공용 모달.
// 카드들이 가로 스크롤 컨테이너(overflow-x-auto) 안에 있어서, 카드 옆에 바로 드롭다운을 띄우면
// 스크롤 컨테이너가 세로 방향도 같이 잘라버리는 CSS 특성 때문에 잘려 보임 — 그래서 카드 옆 팝오버
// 대신 화면 중앙에 뜨는 모달 하나를 page.tsx에서 공용으로 관리하는 방식을 택함 (MiniPlayer와 같은 패턴).
// z-50인 이유: 재생목록 상세 화면(PlaylistDetailOverlay, z-40)의 "담기" 버튼에서도 이 모달을
// 띄우는데, 같은 z-40이면 어느 게 위로 뜰지 DOM 순서에 기대야 해서 명시적으로 한 단계 위로 뺌.
export default function AddToPlaylistModal({
  tracks,
  playlists,
  onClose,
  onAddToPlaylist,
  onCreatePlaylist,
}: AddToPlaylistModalProps) {
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");

  function handleAdd(playlistId: number) {
    onAddToPlaylist(playlistId);
    setAddedIds((prev) => new Set(prev).add(playlistId));
  }

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    onCreatePlaylist(name);
    setNewName("");
    setIsCreating(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-white/10 bg-neutral-900 p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-white/40">재생목록에 추가</p>
            {tracks.length === 1 ? (
              <>
                <p className="truncate text-sm font-medium">{tracks[0].name}</p>
                <p className="truncate text-xs text-white/50">{tracks[0].artist}</p>
              </>
            ) : (
              <p className="truncate text-sm font-medium">{tracks.length}곡 선택됨</p>
            )}
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

        <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
          {playlists.length === 0 && !isCreating && (
            <p className="py-2 text-center text-xs text-white/40">
              아직 만든 재생목록이 없어요. 아래에서 새로 만들어보세요.
            </p>
          )}
          {playlists.map((playlist) => {
            const isAdded = addedIds.has(playlist.id);
            return (
              <button
                key={playlist.id}
                type="button"
                onClick={() => handleAdd(playlist.id)}
                disabled={isAdded}
                className={`flex items-center justify-between rounded-md px-2 py-2 text-left text-sm ${
                  isAdded ? "text-white/40" : "hover:bg-white/10"
                }`}
              >
                <span className="truncate">{playlist.name}</span>
                <span className="ml-2 shrink-0 text-xs text-white/30">
                  {isAdded ? "✓ 추가됨" : `${playlist.trackCount}곡`}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 border-t border-white/10 pt-3">
          {isCreating ? (
            <div className="flex gap-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") setIsCreating(false);
                }}
                placeholder="재생목록 이름"
                className="min-w-0 flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={handleCreate}
                className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-sm text-black"
              >
                만들기
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsCreating(true)}
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-2 text-left text-sm text-white/70 hover:bg-white/10"
            >
              <span className="text-base leading-none">＋</span> 새 재생목록
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
