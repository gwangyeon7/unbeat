"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Playlist, PlaylistTrack } from "@/lib/playlistApi";

type PlaylistDetailOverlayProps = {
  playlist: Playlist;
  // undefined = 아직 로딩 중 (아코디언 시절과 같은 지연 로딩 캐시를 그대로 재사용)
  tracks: PlaylistTrack[] | undefined;
  onClose: () => void;
  // 곡 이름을 직접 누르면 그 한 곡만 바로 재생 (기존 "비슷한 곡 라디오" 흐름 그대로)
  onPlayTrack: (track: { name: string; artist: string; image?: string | null }) => void;
  // 고른 곡들을 순서대로 이어재생(repeat=false) / 반복재생(repeat=true)
  onPlaySelected: (tracks: PlaylistTrack[], repeat: boolean) => void;
  onAddSelectedToPlaylist: (tracks: PlaylistTrack[]) => void;
  onRemoveTrack: (trackId: number) => void;
  onDeleteSelected: (trackIds: number[]) => void;
  // (게이미피케이션 2단계) 공개/비공개 전환 — 비로그인 상태에서 공개로 바꾸려 하면 호출하는 쪽
  // (page.tsx)이 로그인 모달을 띄움.
  onToggleVisibility: () => void;
  isTogglingVisibility: boolean;
  // 곡이 하나도 없을 때 "노래 추가"를 누르면 호출 — page.tsx가 이 화면을 닫고 검색 화면을 열어줌
  onAddSongs?: () => void;
};

const LONG_PRESS_MS = 400;
const MOVE_CANCEL_PX = 10;

// 이모지 대신 글자색을 따라가는 선 아이콘만 사용
function Icon({ children, className = "h-5 w-5" }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// 재생목록 상세 화면.
// - 곡 행 오른쪽엔 ⋮ 하나만 두고, 재생/다른 재생목록에 추가/삭제/여러 곡 선택은 그 메뉴(바텀시트)로.
// - 여러 곡 선택: 곡을 꾹 누르면 선택 모드가 켜지고, 누른 채로 위아래로 끌면 지나간 곡이 같이 선택됨
//   (요즘 폰 사진/파일 앱과 같은 방식). 데스크톱은 헤더의 "선택" 버튼으로 켬.
// - 선택 모드에서만 아래 액션바(이어재생/반복재생/담기/삭제)가 보임.
export default function PlaylistDetailOverlay({
  playlist,
  tracks,
  onClose,
  onPlayTrack,
  onPlaySelected,
  onAddSelectedToPlaylist,
  onRemoveTrack,
  onDeleteSelected,
  onToggleVisibility,
  isTogglingVisibility,
  onAddSongs,
}: PlaylistDetailOverlayProps) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  // 곡 행 ⋮를 누르면 열리는 바텀시트의 대상 곡
  const [menuTrack, setMenuTrack] = useState<PlaylistTrack | null>(null);
  // 여러 곡을 한 번에 지우는 건 실수하면 크니까 확인 모달을 둠(개별 삭제는 바로)
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  const list = tracks ?? [];
  const selectedTracks = list.filter((t) => selectedIds.has(t.id));
  const hasSelection = selectedTracks.length > 0;

  // 네이티브 터치 리스너는 한 번만 달고, 최신 값은 ref로 읽음(리스너 재등록 방지)
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<PlaylistTrack[]>(list);
  listRef.current = list;
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;
  // 길게 눌러서 선택을 시작한 직후 손가락을 뗄 때 발생하는 click이 곡 재생/토글로 새지 않게 막음
  const suppressClickRef = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    let timer: number | null = null;
    let active = false;
    let startX = 0;
    let startY = 0;
    let anchor = -1;
    let base = new Set<number>();

    function indexAt(x: number, y: number): number | null {
      const hit = document.elementFromPoint(x, y)?.closest("[data-idx]") as HTMLElement | null;
      return hit ? Number(hit.dataset.idx) : null;
    }

    function clearTimer() {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      const idx = indexAt(t.clientX, t.clientY);
      if (idx === null) return;
      startX = t.clientX;
      startY = t.clientY;
      clearTimer();
      timer = window.setTimeout(() => {
        const track = listRef.current[idx];
        if (!track) return;
        active = true;
        anchor = idx;
        base = new Set(selectedRef.current);
        setSelectionMode(true);
        setSelectedIds(new Set([...base, track.id]));
        navigator.vibrate?.(10);
      }, LONG_PRESS_MS);
    }

    function onTouchMove(e: TouchEvent) {
      const t = e.touches[0];
      if (!active) {
        // 길게 누르기 전에 움직이면 그냥 스크롤로 보고 취소
        if (Math.abs(t.clientX - startX) > MOVE_CANCEL_PX || Math.abs(t.clientY - startY) > MOVE_CANCEL_PX) {
          clearTimer();
        }
        return;
      }
      // 선택 드래그 중에는 화면이 스크롤되지 않게 막음
      e.preventDefault();
      const idx = indexAt(t.clientX, t.clientY);
      if (idx !== null) {
        const from = Math.min(anchor, idx);
        const to = Math.max(anchor, idx);
        const next = new Set(base);
        for (let i = from; i <= to; i++) {
          const track = listRef.current[i];
          if (track) next.add(track.id);
        }
        setSelectedIds(next);
      }
      // 위/아래 가장자리 근처에서 끌면 목록이 알아서 스크롤
      const rect = el!.getBoundingClientRect();
      if (t.clientY < rect.top + 60) el!.scrollBy(0, -14);
      else if (t.clientY > rect.bottom - 60) el!.scrollBy(0, 14);
    }

    function onTouchEnd() {
      clearTimer();
      if (active) {
        active = false;
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 350);
      }
    }

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      clearTimer();
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  function toggle(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) => (prev.size === list.length ? new Set() : new Set(list.map((t) => t.id))));
  }

  function exitSelectionMode() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  function handleRowClick(t: PlaylistTrack) {
    if (suppressClickRef.current) return;
    if (selectionMode) {
      toggle(t.id);
      return;
    }
    onPlayTrack({ name: t.trackName, artist: t.artistName, image: t.imageUrl });
  }

  if (typeof document === "undefined") return null;

  const actionButton =
    "flex flex-col items-center gap-1 rounded-md px-3 py-1.5 text-xs text-white/70 hover:bg-white/5 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent";

  return createPortal(
    <div className="fixed inset-0 z-40 flex flex-col bg-neutral-950">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-4">
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="rounded-full p-2 text-white/50 hover:bg-white/10 hover:text-white"
        >
          <Icon>
            <path d="M6 9l6 6 6-6" />
          </Icon>
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-semibold">{playlist.name}</p>
          <p className="text-xs text-white/40">
            {selectionMode ? `${selectedTracks.length}곡 선택됨` : `${list.length}곡`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {/* (게이미피케이션 2단계) 공개/비공개 전환 — 비로그인 상태로 공개를 누르면 호출 쪽(page.tsx)이
              로그인 모달을 띄움. 선택 모드일 땐 헤더가 복잡해지지 않게 숨김. */}
          {!selectionMode && (
            <button
              type="button"
              onClick={onToggleVisibility}
              disabled={isTogglingVisibility}
              title={playlist.isPublic ? "공개 중 — 눌러서 비공개로 전환" : "비공개 — 눌러서 다른 사람에게 공개"}
              className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] disabled:opacity-40 ${
                playlist.isPublic
                  ? "bg-accent/20 text-accent"
                  : "text-white/40 hover:bg-white/10 hover:text-white/70"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${playlist.isPublic ? "bg-accent" : "bg-white/30"}`}
                aria-hidden="true"
              />
              {playlist.isPublic ? "공개" : "비공개"}
            </button>
          )}
          {list.length > 0 && (
            <button
              type="button"
              onClick={() => (selectionMode ? exitSelectionMode() : setSelectionMode(true))}
              className="rounded-full px-2 py-1 text-[11px] text-white/60 hover:bg-white/10 hover:text-white"
            >
              {selectionMode ? "취소" : "선택"}
            </button>
          )}
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-2xl min-h-0 flex-1 flex-col overflow-hidden px-4 pt-3">
        {selectionMode && list.length > 0 && (
          <button
            type="button"
            onClick={toggleAll}
            className="mb-2 self-start rounded-md px-2 py-1 text-xs text-white/50 hover:bg-white/5 hover:text-white/80"
          >
            {selectedIds.size === list.length ? "전체 해제" : "전체 선택"}
          </button>
        )}

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto pb-4">
          {tracks === undefined ? (
            <p className="p-4 text-sm text-white/40">불러오는 중...</p>
          ) : list.length === 0 ? (
            <div className="flex flex-col items-center gap-4 px-4 py-16 text-center">
              <p className="text-sm text-white/50">아직 곡이 없어요.</p>
              {onAddSongs && (
                <button
                  type="button"
                  onClick={onAddSongs}
                  className="flex items-center gap-1.5 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black hover:bg-white/90"
                >
                  <Icon className="h-4 w-4">
                    <path d="M12 5v14M5 12h14" />
                  </Icon>
                  노래 추가
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {list.map((t, idx) => {
                const selected = selectedIds.has(t.id);
                return (
                  <div
                    key={t.id}
                    data-idx={idx}
                    style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
                    className={`flex items-center gap-3 rounded-md px-2 py-2 ${
                      selected ? "bg-white/10" : "hover:bg-white/5"
                    }`}
                  >
                    {selectionMode && (
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                          selected ? "border-accent bg-accent text-black" : "border-white/30"
                        }`}
                        aria-hidden="true"
                      >
                        {selected && (
                          <Icon className="h-3.5 w-3.5">
                            <path d="M5 12l5 5 9-10" />
                          </Icon>
                        )}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => handleRowClick(t)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded bg-white/5">
                        {t.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={t.imageUrl}
                            alt={t.trackName}
                            draggable={false}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="text-sm text-white/25">♪</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm">{t.trackName}</p>
                        <p className="truncate text-xs text-white/50">{t.artistName}</p>
                      </div>
                    </button>
                    {!selectionMode && (
                      <button
                        type="button"
                        onClick={() => setMenuTrack(t)}
                        aria-label="더보기"
                        className="shrink-0 rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white"
                      >
                        <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
                          <circle cx="12" cy="5" r="1.8" />
                          <circle cx="12" cy="12" r="1.8" />
                          <circle cx="12" cy="19" r="1.8" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 하단 액션바는 선택 모드에서만. 아무것도 선택 안 하면 비활성화해서 실수로 눌리는 걸 막음. */}
      {selectionMode && (
        <div className="border-t border-white/10 bg-neutral-900/80 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center justify-around">
            <button
              type="button"
              disabled={!hasSelection}
              onClick={() => onPlaySelected(selectedTracks, false)}
              className={actionButton}
            >
              <Icon>
                <path d="M7 5l12 7-12 7z" fill="currentColor" />
              </Icon>
              이어재생
            </button>
            <button
              type="button"
              disabled={!hasSelection}
              onClick={() => onPlaySelected(selectedTracks, true)}
              className={actionButton}
            >
              <Icon>
                <path d="M17 2l4 4-4 4" />
                <path d="M3 11V9a3 3 0 0 1 3-3h15" />
                <path d="M7 22l-4-4 4-4" />
                <path d="M21 13v2a3 3 0 0 1-3 3H3" />
              </Icon>
              반복재생
            </button>
            <button
              type="button"
              disabled={!hasSelection}
              onClick={() => onAddSelectedToPlaylist(selectedTracks)}
              className={actionButton}
            >
              <Icon>
                <path d="M12 5v14M5 12h14" />
              </Icon>
              담기
            </button>
            <button
              type="button"
              disabled={!hasSelection}
              onClick={() => setIsConfirmingDelete(true)}
              className="flex flex-col items-center gap-1 rounded-md px-3 py-1.5 text-xs text-red-400/80 hover:bg-white/5 hover:text-red-400 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Icon>
                <path d="M4 7h16M10 11v6M14 11v6" />
                <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
                <path d="M9 7V4h6v3" />
              </Icon>
              삭제
            </button>
          </div>
        </div>
      )}

      {/* 곡 ⋮ 메뉴(바텀시트) — z-50이라 이 화면(z-40) 위에 뜸 */}
      {menuTrack && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
          onClick={() => setMenuTrack(null)}
        >
          <div
            className="w-full max-w-lg rounded-t-2xl border border-white/10 bg-neutral-900 pb-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-white/10 px-5 py-4">
              <p className="truncate text-sm font-semibold">{menuTrack.trackName}</p>
              <p className="truncate text-xs text-white/50">{menuTrack.artistName}</p>
            </div>
            {[
              {
                label: "재생",
                onClick: () =>
                  onPlayTrack({
                    name: menuTrack.trackName,
                    artist: menuTrack.artistName,
                    image: menuTrack.imageUrl,
                  }),
              },
              { label: "다른 재생목록에 추가", onClick: () => onAddSelectedToPlaylist([menuTrack]) },
              {
                label: "여러 곡 선택",
                onClick: () => {
                  setSelectionMode(true);
                  setSelectedIds(new Set([menuTrack.id]));
                },
              },
              { label: "이 재생목록에서 삭제", danger: true, onClick: () => onRemoveTrack(menuTrack.id) },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setMenuTrack(null);
                  item.onClick();
                }}
                className={`block w-full px-5 py-3.5 text-left text-sm hover:bg-white/5 ${
                  item.danger ? "text-red-400" : "text-white"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 삭제 확인 모달 — z-50이라 이 화면(z-40) 위에 뜸(AddToPlaylistModal과 같은 이유) */}
      {isConfirmingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          onClick={() => setIsConfirmingDelete(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-white/10 bg-neutral-900 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-1 text-sm font-medium">선택한 {selectedTracks.length}곡을 삭제할까요?</p>
            <p className="mb-4 text-xs text-white/40">
              "{playlist.name}" 재생목록에서만 지워져요. 되돌릴 수 없어요.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsConfirmingDelete(false)}
                className="rounded-md px-3 py-1.5 text-sm text-white/60 hover:bg-white/10"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteSelected(selectedTracks.map((t) => t.id));
                  exitSelectionMode();
                  setIsConfirmingDelete(false);
                }}
                className="rounded-md bg-red-500/90 px-3 py-1.5 text-sm text-white"
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
