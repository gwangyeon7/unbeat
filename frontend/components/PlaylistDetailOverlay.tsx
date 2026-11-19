"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { Playlist, PlaylistTrack } from "@/lib/playlistApi";
import { thumbUrl } from "@/lib/imageSize";

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
  onDeleteSelected?: (trackIds: number[]) => void;
  // (게이미피케이션 2단계) 공개/비공개 전환 — 비로그인 상태에서 공개로 바꾸려 하면 호출하는 쪽
  // (page.tsx)이 로그인 모달을 띄움.
  onToggleVisibility: () => void;
  isTogglingVisibility: boolean;
  // 곡이 하나도 없을 때 "노래 추가"를 누르면 호출 — page.tsx가 이 화면을 닫고 검색 화면을 열어줌
  onAddSongs?: () => void;
  // 곡 ⋮ 메뉴의 "다음에 재생" / "대기열에 추가" (page.tsx가 미니 플레이어 큐에 넣음)
  onPlayNext?: (track: { name: string; artist: string; image?: string | null }) => void;
  onAddToQueue?: (track: { name: string; artist: string; image?: string | null }) => void;
};

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
  onToggleVisibility,
  isTogglingVisibility,
  onAddSongs,
  onPlayNext,
  onAddToQueue,
}: PlaylistDetailOverlayProps) {
  // 곡 행 ⋮를 누르면 열리는 바텀시트의 대상 곡
  const [menuTrack, setMenuTrack] = useState<PlaylistTrack | null>(null);
  const list = tracks ?? [];
  function handleRowClick(t: PlaylistTrack) {
    onPlayTrack({ name: t.trackName, artist: t.artistName, image: t.imageUrl });
  }

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-40 flex flex-col bg-neutral-950" style={{ paddingBottom: "var(--mini-pad, 0px)" }}>
      {/* 헤더: 양쪽 칸 너비를 같게(w-20) 둬서 제목이 항상 정가운데. 오른쪽엔 공개/비공개 전환만 둠 —
          예전 "선택" 버튼과 선택 모드는 없애고, 그 안에 있던 기능은 곡마다 있는 ⋮ 메뉴로 옮김. */}
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-4">
        <div className="flex w-20 shrink-0 justify-start">
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
        </div>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-semibold">{playlist.name}</p>
          <p className="text-xs text-white/40">{list.length}곡</p>
        </div>
        <div className="flex w-20 shrink-0 justify-end">
          {/* 비로그인 상태로 공개를 누르면 호출 쪽(page.tsx)이 로그인 모달을 띄움 */}
          <button
            type="button"
            onClick={onToggleVisibility}
            disabled={isTogglingVisibility}
            title={playlist.isPublic ? "공개 중 — 눌러서 비공개로 전환" : "비공개 — 눌러서 다른 사람에게 공개"}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] disabled:opacity-40 ${
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
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-2xl min-h-0 flex-1 flex-col overflow-hidden px-4 pt-3">

        <div className="min-h-0 flex-1 overflow-y-auto pb-4">
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
              {onAddSongs && (
                <button
                  type="button"
                  onClick={onAddSongs}
                  className="flex items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-white/5"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded bg-white/10 text-white/70">
                    <Icon className="h-5 w-5">
                      <path d="M12 5v14M5 12h14" />
                    </Icon>
                  </span>
                  <span className="text-sm text-white/80">노래 추가</span>
                </button>
              )}
              {list.map((t, idx) => {
                return (
                  <div
                    key={t.id}
                    data-idx={idx}
                    style={{ WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
                    className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-white/5"
                  >
                    <button
                      type="button"
                      onClick={() => handleRowClick(t)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded bg-white/5">
                        {t.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={thumbUrl(t.imageUrl, 120) ?? t.imageUrl}
                            alt={t.trackName}
                            loading="lazy"
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
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>


      {/* 곡 ⋮ 메뉴(바텀시트) — z-50이라 이 화면(z-40) 위에 뜸 */}
      {menuTrack && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60"
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
              { label: "이 곡 반복재생", onClick: () => onPlaySelected([menuTrack], true) },
              ...(onPlayNext
                ? [
                    {
                      label: "다음에 재생",
                      onClick: () =>
                        onPlayNext({
                          name: menuTrack.trackName,
                          artist: menuTrack.artistName,
                          image: menuTrack.imageUrl,
                        }),
                    },
                  ]
                : []),
              ...(onAddToQueue
                ? [
                    {
                      label: "대기열에 추가",
                      onClick: () =>
                        onAddToQueue({
                          name: menuTrack.trackName,
                          artist: menuTrack.artistName,
                          image: menuTrack.imageUrl,
                        }),
                    },
                  ]
                : []),
              { label: "다른 재생목록에 추가", onClick: () => onAddSelectedToPlaylist([menuTrack]) },
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
    </div>,
    document.body
  );
}
