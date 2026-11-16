"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  followUser,
  getFollowList,
  unfollowUser,
  type FollowUser,
  type PlaylistTrack,
  type PublicPlaylist,
  type UserProfilePage,
} from "@/lib/playlistApi";
import { MUSIC_CATEGORIES } from "@/lib/categories";

type RankingPageProps = {
  onClose: () => void;
  publicPlaylists: PublicPlaylist[];
  isLoading: boolean;
  // (2.5단계) 닉네임을 눌러서 들어간 "그 사람 페이지" — null이면 메인 피드 화면.
  viewingProfileNickname: string | null;
  profilePlaylists: PublicPlaylist[] | null;
  viewingPlaylistId: number | null;
  tracks: PlaylistTrack[] | null;
  onSelectPlaylist: (playlistId: number) => void;
  onViewProfile: (nickname: string) => void;
  onBack: () => void;
  onPlayTrack: (track: { name: string; artist: string; image?: string | null }) => void;
  // (게이미피케이션 3단계) 좋아요 토글 — 비로그인이면 호출하는 쪽(page.tsx)이 로그인 모달을 띄움.
  onToggleLike: (playlist: PublicPlaylist) => void;
  // (프로필 화면/팔로우, 2026-10-29)
  profileInfo: UserProfilePage | null;
  onToggleFollow: () => void;
  onSaveBio: (bio: string) => void;
};

// 팔로워/팔로잉 목록 바텀시트 — 프로필 카드의 숫자를 누르면 열림. 목록에서 바로 팔로우/언팔로우하고,
// 닉네임을 누르면 그 사람 프로필로 이동.
function FollowListSheet({
  nickname,
  type,
  onClose,
  onViewProfile,
}: {
  nickname: string;
  type: "followers" | "following";
  onClose: () => void;
  onViewProfile: (nickname: string) => void;
}) {
  const [users, setUsers] = useState<FollowUser[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getFollowList(nickname, type)
      .then((r) => !cancelled && setUsers(r.users))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [nickname, type]);

  async function toggle(u: FollowUser) {
    const next = !u.followedByMe;
    setUsers((list) => list && list.map((x) => (x.nickname === u.nickname ? { ...x, followedByMe: next } : x)));
    try {
      if (next) await followUser(u.nickname);
      else await unfollowUser(u.nickname);
    } catch {
      setUsers((list) => list && list.map((x) => (x.nickname === u.nickname ? { ...x, followedByMe: u.followedByMe } : x)));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="flex max-h-[70vh] w-full max-w-2xl flex-col rounded-t-xl border-t border-white/10 bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="border-b border-white/10 px-5 py-3 text-sm font-semibold">
          {type === "followers" ? "팔로워" : "팔로잉"}
        </p>
        <div className="overflow-y-auto px-2 pb-6">
          {failed ? (
            <p className="p-4 text-sm text-white/40">불러오지 못했어요.</p>
          ) : users === null ? (
            <p className="p-4 text-sm text-white/40">불러오는 중...</p>
          ) : users.length === 0 ? (
            <p className="p-4 text-sm text-white/40">
              {type === "followers" ? "아직 팔로워가 없어요." : "아직 팔로우한 사람이 없어요."}
            </p>
          ) : (
            users.map((u) => (
              <div key={u.nickname} className="flex items-center gap-3 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onViewProfile(u.nickname);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-black">
                    {u.nickname.charAt(0)}
                  </span>
                  <span className="truncate text-sm">{u.nickname}</span>
                </button>
                {!u.isMe && (
                  <button
                    type="button"
                    onClick={() => toggle(u)}
                    className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold ${
                      u.followedByMe ? "border border-white/20 text-white/80" : "bg-accent text-black"
                    }`}
                  >
                    {u.followedByMe ? "팔로잉" : "팔로우"}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// 프로필 상단 카드 — 아바타/닉네임/팔로워·팔로잉/팔로우 버튼/한 줄 소개/통계/배지/장르는 모두
// 서버가 자동 계산해서 내려주는 값이고, 사용자가 직접 입력하는 건 한 줄 소개(선택)뿐.
function ProfileHeader({
  info,
  onToggleFollow,
  onSaveBio,
  onViewProfile,
}: {
  info: UserProfilePage;
  onToggleFollow: () => void;
  onSaveBio: (bio: string) => void;
  onViewProfile: (nickname: string) => void;
}) {
  const [followSheet, setFollowSheet] = useState<"followers" | "following" | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(info.bio ?? "");

  return (
    <div className="mb-6 px-1 pt-1">
      <div className="flex items-center gap-3">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-xl font-bold text-black">
          {info.nickname.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold">{info.nickname}</p>
          <p className="mt-0.5 text-xs text-white/55">
            <button type="button" onClick={() => setFollowSheet("followers")} className="hover:text-white">
              팔로워 <b className="text-white/80">{info.followerCount}</b>
            </button>
            {" · "}
            <button type="button" onClick={() => setFollowSheet("following")} className="hover:text-white">
              팔로잉 <b className="text-white/80">{info.followingCount}</b>
            </button>
          </p>
        </div>
        {!info.isMe && (
          <button
            type="button"
            onClick={onToggleFollow}
            className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition ${
              info.followedByMe
                ? "border border-white/20 text-white/80 hover:bg-white/10"
                : "bg-accent text-black hover:opacity-90"
            }`}
          >
            {info.followedByMe ? "팔로잉" : "팔로우"}
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-3 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={60}
            placeholder="한 줄 소개 (60자)"
            className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => {
              onSaveBio(draft);
              setEditing(false);
            }}
            className="shrink-0 rounded-lg bg-accent px-3 text-sm font-semibold text-black"
          >
            저장
          </button>
        </div>
      ) : info.bio ? (
        <p className="mt-3 text-sm text-white/80">
          {info.bio}
          {info.isMe && (
            <button type="button" onClick={() => { setDraft(info.bio ?? ""); setEditing(true); }} className="ml-2 text-xs text-white/40 underline">
              수정
            </button>
          )}
        </p>
      ) : info.isMe ? (
        <button type="button" onClick={() => setEditing(true)} className="mt-3 text-xs text-white/40 underline">
          + 한 줄 소개 추가
        </button>
      ) : null}

      <div className="mt-3 flex items-center gap-3 text-xs text-white/60">
        <span>재생목록 <b className="text-white/85">{info.playlists.length}</b></span>
        <span>받은 좋아요 <b className="text-white/85">{info.totalLikes}</b></span>
      </div>

      {followSheet && (
        <FollowListSheet
          nickname={info.nickname}
          type={followSheet}
          onClose={() => setFollowSheet(null)}
          onViewProfile={onViewProfile}
        />
      )}
    </div>
  );
}

// 프로필 화면의 재생목록 격자 아이템(2026-10-29) — 큰 이미지 카드를 세로로 쌓으니 난잡해 보인다는
// 피드백으로, 정사각형 커버 + 이름/곡 수는 이미지 아래에 따로 적는 2열 격자로 바꿈.
function PlaylistGridItem({
  playlist,
  onSelectPlaylist,
  onToggleLike,
}: {
  playlist: PublicPlaylist;
  onSelectPlaylist: (id: number) => void;
  onToggleLike: (playlist: PublicPlaylist) => void;
}) {
  return (
    <div className="min-w-0">
      <button type="button" onClick={() => onSelectPlaylist(playlist.id)} className="block w-full text-left">
        <div className="aspect-square w-full overflow-hidden rounded-xl bg-neutral-800">
          {playlist.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={playlist.coverImageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span className="text-3xl text-white/15">♪</span>
            </div>
          )}
        </div>
        <p className="mt-2 truncate text-sm font-semibold">{playlist.name}</p>
      </button>
      <div className="mt-0.5 flex items-center text-xs text-white/50">
        <button
          type="button"
          onClick={() => onToggleLike(playlist)}
          className="flex items-center gap-1 hover:text-white/80"
          aria-label="좋아요"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3 w-3"
            fill={playlist.likedByMe ? "#ff3b5c" : "none"}
            stroke={playlist.likedByMe ? "#ff3b5c" : "currentColor"}
            strokeWidth="2"
          >
            <path d="M12 21s-7.5-4.6-10-9.3C.3 7.9 2.6 4 6.6 4c2 0 3.6 1 5.4 3 1.8-2 3.4-3 5.4-3 4 0 6.3 3.9 4.6 7.7C19.5 16.4 12 21 12 21z" />
          </svg>
          {playlist.likeCount}
        </button>
      </div>
    </div>
  );
}

// (디자인, 2026-10-10) "네이버 블로그 피드처럼" 꾸며달라는 요청으로 추가한 매거진형 카드 —
// mcp__visualize로 A(모자이크 리스트)/B(인스타형 그리드)/C(매거진형) 세 방향을 스케치해서
// 보여준 뒤 C로 확정. 커버 이미지는 PublicPlaylistResponse.coverImageUrl(재생목록에 담긴 곡
// 중 이미지가 있는 가장 최근 곡)을 그대로 씀 — 없으면 단색 플레이스홀더 + ♪ 아이콘으로 대체.
// 아바타 원 배경색은 사용자마다 다르게 하지 않고 브랜드 컬러(accent) 하나로 통일함(디자인
// 메모리 — "새 색을 들여오지 말고 기존 브랜드 컬러 하나를 재사용").
function PlaylistCard({
  playlist,
  onSelectPlaylist,
  onViewProfile,
  onToggleLike,
  showNickname,
  likeCountToShow,
  rank,
}: {
  playlist: PublicPlaylist;
  onSelectPlaylist: (id: number) => void;
  onViewProfile: (nickname: string) => void;
  onToggleLike: (playlist: PublicPlaylist) => void;
  showNickname: boolean;
  // "이번 주" 탭에서는 주간 좋아요 수를 보여줌(없으면 전체 좋아요 수)
  likeCountToShow?: number;
  // 차트 순위(1부터). 메달 같은 장식 없이 숫자만 — 순위 화면(전체/이번 주)에서만 넘김
  rank?: number;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelectPlaylist(playlist.id)}
      className="relative block h-40 w-full shrink-0 overflow-hidden rounded-2xl text-left"
    >
      {playlist.coverImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={playlist.coverImageUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-800">
          <span className="text-3xl text-white/15">♪</span>
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
      {rank !== undefined && (
        <span className="absolute left-4 top-3 text-2xl font-extrabold tabular-nums text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">
          {rank}
        </span>
      )}
      <div className="absolute inset-x-4 bottom-3 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="mb-1.5 truncate text-base font-bold">{playlist.name}</p>
          <div className="flex items-center gap-1.5">
            {/* (2.5단계) 닉네임(아바타+이름)을 누르면 그 사람 페이지로 — 재생목록 카드 자체를
                누르는 것과는 다른 동작이라 stopPropagation으로 분리. 이미 프로필 화면 안이면
                또 보여줄 필요가 없어서 showNickname=false로 숨김. */}
            {showNickname && playlist.ownerNickname && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onViewProfile(playlist.ownerNickname!);
                }}
                className="flex items-center gap-1.5 rounded-full py-0.5 pr-1 hover:bg-white/10"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-black">
                  {playlist.ownerNickname.charAt(0)}
                </span>
                <span className="text-xs text-white/80">{playlist.ownerNickname}</span>
              </span>
            )}
            {showNickname && playlist.ownerNickname && (
              <span className="h-0.5 w-0.5 shrink-0 rounded-full bg-white/40" />
            )}
            {showNickname && <span className="shrink-0 text-xs text-white/55">{playlist.trackCount}곡</span>}
          </div>
        </div>
        {/* (게이미피케이션 3단계, 2026-10-10) 처음엔 등수 배지(금/은/동)를 같이 넣었는데
            "짜치다"는 반응으로 빼고 좋아요만 남김 — 정렬 순서(likeCount desc, page.tsx가
            이미 그 순서로 받은 걸 그대로 렌더링) 자체가 랭킹 역할을 함. 카드 자체를 누르는
            것과 분리하려고 stopPropagation. */}
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onToggleLike(playlist);
          }}
          className="flex shrink-0 items-center gap-1 rounded-full bg-black/30 px-2 py-1 hover:bg-black/50"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3 w-3"
            fill={playlist.likedByMe ? "#ff3b5c" : "none"}
            stroke={playlist.likedByMe ? "#ff3b5c" : "currentColor"}
            strokeWidth="2"
          >
            <path d="M12 21s-7.5-4.6-10-9.3C.3 7.9 2.6 4 6.6 4c2 0 3.6 1 5.4 3 1.8-2 3.4-3 5.4-3 4 0 6.3 3.9 4.6 7.7C19.5 16.4 12 21 12 21z" />
          </svg>
          <span className="text-xs font-medium text-white/80">{likeCountToShow ?? playlist.likeCount}</span>
        </span>
      </div>
    </button>
  );
}

// (게이미피케이션, UI 재구조화 2026-10-10) 재생목록 상세 화면 안 🌐 아이콘 + 모달로 처음 만들었는데,
// "이게 게이미피케이션 기능인데 아이콘 하나로 띡 나오니까 이상하다, 랭킹 페이지를 따로 두는 게
// 낫겠다"는 라이브 테스트 피드백을 받고 전용 전체화면 페이지로 분리함. 같은 피드백 라운드에서
// "재생목록이 그냥 올라가기보단 네이버 블로그처럼 닉네임을 정하고, 그 닉네임을 눌러서 그 사람
// 페이지로 들어가는 식이면 좋겠다"는 요청을 받아 닉네임/프로필 화면을 추가함(2.5단계) — 피드 ->
// (닉네임 클릭) 프로필 -> (재생목록 클릭) 곡 목록, 또는 피드 -> (재생목록 바로 클릭) 곡 목록,
// 두 경로 모두 지원. PlaylistDetailOverlay와 같은 전체화면 createPortal 패턴을 재사용해서 UI
// 일관성을 맞춤.
export default function RankingPage({
  onClose,
  publicPlaylists,
  isLoading,
  viewingProfileNickname,
  profilePlaylists,
  viewingPlaylistId,
  tracks,
  onSelectPlaylist,
  onViewProfile,
  onBack,
  onPlayTrack,
  onToggleLike,
  profileInfo,
  onToggleFollow,
  onSaveBio,
}: RankingPageProps) {
  // (랭킹 카테고리 필터, 2026-10-10 추가) 이미 fetch된 publicPlaylists(최대 50개)를
  // 클라이언트에서 거르기만 하면 되는 순수 화면 상태라, page.tsx로 끌어올리지 않고 여기 로컬
  // state로 둠 — 새 백엔드 쿼리 파라미터가 필요 없음. null이면 "전체"(필터 없음).
  const [selectedFilterCategory, setSelectedFilterCategory] = useState<string | null>(null);
  // (랭킹 탭, 2026-10-29) "전체"(누적 좋아요 순) / "이번 주"(최근 7일 좋아요 순). 팔로우 탭은
  // 팔로우 기능을 만든 뒤 추가 예정. 이것도 이미 받아온 목록을 클라이언트에서 정렬만 함.
  const [rankTab, setRankTab] = useState<"all" | "week" | "liked">("all");

  if (typeof document === "undefined") return null;

  // 셋 중 어느 화면인지 — 재생목록 상세(곡 목록) > 프로필 > 메인 피드 순으로 우선.
  const screen: "tracks" | "profile" | "feed" =
    viewingPlaylistId !== null ? "tracks" : viewingProfileNickname !== null ? "profile" : "feed";

  const activeList = viewingProfileNickname !== null ? profilePlaylists ?? [] : publicPlaylists;
  const currentTrackPlaylist = activeList.find((p) => p.id === viewingPlaylistId);

  // 메인 피드 화면에서만 쓰는 필터링된 목록 — 프로필 화면은 "그 사람의 재생목록 전체"를
  // 보여주는 게 목적이라 카테고리 필터를 적용하지 않음.
  const categoryFiltered =
    selectedFilterCategory === null
      ? publicPlaylists
      : publicPlaylists.filter((p) => p.category === selectedFilterCategory);
  // "좋아요한" 탭 — 이미 받아온 공개 목록에서 내가 ♥한 것만 모아 봄(새 API 없음). 카드에 표시되는
  // 등수는 전체 랭킹에서의 실제 순위를 그대로 보여줌.
  const filteredFeedPlaylists =
    rankTab === "week"
      ? categoryFiltered
          .filter((p) => p.weeklyLikeCount > 0)
          .sort((a, b) => b.weeklyLikeCount - a.weeklyLikeCount)
      : rankTab === "liked"
        ? categoryFiltered.filter((p) => p.likedByMe)
        : categoryFiltered;
  const overallRank = (id: number) => publicPlaylists.findIndex((p) => p.id === id) + 1;

  const title =
    screen === "tracks"
      ? currentTrackPlaylist?.name ?? "재생목록"
      : screen === "profile"
        ? `${viewingProfileNickname}님의 재생목록`
        : "인기 차트";

  return createPortal(
    <div className="fixed inset-0 z-40 flex flex-col bg-neutral-950">
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <button
          type="button"
          onClick={screen === "feed" ? onClose : onBack}
          aria-label={screen === "feed" ? "닫기" : "뒤로"}
          className="rounded-full p-2 text-white/50 hover:bg-white/10 hover:text-white"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
            aria-hidden="true"
          >
            {screen === "feed" ? <path d="M6 9l6 6 6-6" /> : <path d="M15 18l-6-6 6-6" />}
          </svg>
        </button>
        <p className="truncate text-sm font-semibold">{title}</p>
        {screen === "feed" ? (
          <div className="w-9" />
        ) : (
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded-full p-2 text-white/50 hover:bg-white/10 hover:text-white"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* (레이아웃, 2026-10-10) 처음엔 PlaylistDetailOverlay(곡 리스트용)와 똑같이 max-w-2xl
          단일 칼럼을 그대로 재사용했는데, 매거진 카드 하나만 화면 가운데 떠 있고 양옆은 텅 빈
          채로 남아서 "이상하다"는 피드백을 받음. 카드 화면(피드/프로필)은 헤더와 같은
          max-w-6xl(사이트 전체 컨벤션)까지 넓히고 그리드로 깔아서 카드가 쌓일수록 자연스럽게
          여러 열로 채워지게 함 — 곡 리스트(tracks) 화면은 원래도 텍스트 줄 나열이라 좁은 폭이
          더 읽기 편해서 그대로 둠. */}
      <div
        className={`mx-auto w-full flex-1 overflow-y-auto px-4 pt-4 sm:px-6 ${
          screen === "tracks" ? "max-w-2xl" : "max-w-6xl"
        }`}
      >
        {screen === "tracks" ? (
          tracks === null ? (
            <p className="p-4 text-sm text-white/40">불러오는 중...</p>
          ) : tracks.length === 0 ? (
            <p className="p-4 text-sm text-white/40">아직 곡이 없어요.</p>
          ) : (
            <div className="flex flex-col gap-1 pb-4">
              {tracks.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onPlayTrack({ name: t.trackName, artist: t.artistName, image: t.imageUrl })}
                  className="flex items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-white/5"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded bg-white/5">
                    {t.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.imageUrl} alt={t.trackName} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-sm text-white/25">♪</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm">{t.trackName}</p>
                    <p className="truncate text-xs text-white/50">{t.artistName}</p>
                  </div>
                </button>
              ))}
            </div>
          )
        ) : screen === "profile" ? (
          profilePlaylists === null ? (
            <p className="p-4 text-sm text-white/40">불러오는 중...</p>
          ) : (
            <div className="mx-auto w-full max-w-2xl pb-6">
              {profileInfo && (
                <ProfileHeader
                  key={profileInfo.nickname}
                  info={profileInfo}
                  onToggleFollow={onToggleFollow}
                  onSaveBio={onSaveBio}
                  onViewProfile={onViewProfile}
                />
              )}
              {profilePlaylists.length === 0 ? (
                <p className="p-4 text-sm text-white/40">공개한 재생목록이 없어요.</p>
              ) : (
                <>
                  {/* 대표 재생목록 — 직접 고정하지 않아도 좋아요가 가장 많은(서버가 그 순서로 내려줌) 첫 번째가 맨 위에 크게 */}
                  <p className="mb-2 text-xs font-semibold text-white/50">대표 재생목록</p>
                  <div className="mb-5">
                    <PlaylistCard
                      playlist={profilePlaylists[0]}
                      onSelectPlaylist={onSelectPlaylist}
                      onViewProfile={onViewProfile}
                      onToggleLike={onToggleLike}
                      showNickname={false}
                    />
                  </div>
                  {profilePlaylists.length > 1 && (
                    <>
                      <p className="mb-2 text-xs font-semibold text-white/50">
                        재생목록 {profilePlaylists.length - 1}개 더
                      </p>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-5">
                        {profilePlaylists.slice(1).map((p) => (
                          <PlaylistGridItem
                            key={p.id}
                            playlist={p}
                            onSelectPlaylist={onSelectPlaylist}
                            onToggleLike={onToggleLike}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )
        ) : isLoading ? (
          <p className="p-4 text-sm text-white/40">불러오는 중...</p>
        ) : publicPlaylists.length === 0 ? (
          <p className="p-4 text-sm text-white/40">
            아직 공개된 재생목록이 없어요. 재생목록 상세 화면에서 공개로 전환하면 가장 먼저
            올라와요. (좋아요·랭킹은 곧 추가될 예정이에요)
          </p>
        ) : (
          <>
            {/* (랭킹 카테고리 필터, 2026-10-10 추가) 무드 칩(MoodChips)과 완전히 같은 스타일을
                재사용 — "전체"가 기본/초기화 옵션. 가로로 넘치면 스크롤되게 함. */}
            <div className="mb-3 flex gap-4 border-b border-white/10">
              {([
                ["all", "전체"],
                ["week", "이번 주"],
                ["liked", "좋아요한"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRankTab(value)}
                  className={`-mb-px border-b-2 px-1 pb-2 text-sm font-semibold transition ${
                    rankTab === value
                      ? "border-accent text-accent"
                      : "border-transparent text-white/50 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="scrollbar-none mb-4 flex gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setSelectedFilterCategory(null)}
                className={`shrink-0 rounded-full border px-4 py-2 text-sm transition ${
                  selectedFilterCategory === null
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-white/10 bg-white/5 hover:border-white/30"
                }`}
              >
                전체
              </button>
              {MUSIC_CATEGORIES.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setSelectedFilterCategory(c.value)}
                  className={`shrink-0 rounded-full border px-4 py-2 text-sm transition ${
                    selectedFilterCategory === c.value
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-white/10 bg-white/5 hover:border-white/30"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {filteredFeedPlaylists.length === 0 ? (
              <p className="p-4 text-sm text-white/40">
                {rankTab === "week"
                  ? "이번 주에 좋아요를 받은 재생목록이 아직 없어요. 마음에 드는 재생목록에 ♥를 눌러보세요."
                  : rankTab === "liked"
                    ? "아직 좋아요한 재생목록이 없어요. 마음에 드는 재생목록에 ♥를 눌러보세요. (로그인해야 저장돼요)"
                    : "이 카테고리에는 아직 공개된 재생목록이 없어요."}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 pb-6 sm:grid-cols-2 xl:grid-cols-3">
                {filteredFeedPlaylists.map((p, i) => (
                  <PlaylistCard
                    key={p.id}
                    rank={rankTab === "liked" ? overallRank(p.id) : i + 1}
                    playlist={p}
                    onSelectPlaylist={onSelectPlaylist}
                    onViewProfile={onViewProfile}
                    onToggleLike={onToggleLike}
                    showNickname
                    likeCountToShow={rankTab === "week" ? p.weeklyLikeCount : undefined}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
