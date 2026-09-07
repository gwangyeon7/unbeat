"use client";

import { useEffect, useState } from "react";
import { getLyricsRequests, submitLyricsOverride, takedownLyrics, type LyricsRequestItem } from "@/lib/api";

// 브라우저를 진짜로 새로고침(Cmd+R)하면 React state가 다 날아가서 매번 비밀번호를 다시 쳐야
// 하는 게 불편하다는 피드백으로, 세션스토리지에 잠깐 기억해뒀다가 자동으로 재로그인 시도함.
// localStorage(브라우저를 껐다 켜도 계속 남음) 대신 sessionStorage(탭 닫으면 사라짐)를 쓴 이유는
// 관리자 비밀번호를 굳이 오래 남겨둘 필요는 없어서 — 편의성과 최소한의 보안 사이의 절충.
const ADMIN_SECRET_SESSION_KEY = "unbeat-admin-secret";

// "가사 올려주세요" 버튼(§28)으로 쌓인 요청을 확인하고 직접 구한 가사를 등록하는 화면.
// 로그인/권한 시스템이 없는 프로젝트라 정식 인증 대신 .env의 ADMIN_SECRET과 대조하는
// 최소한의 접근 제한만 씀 — 본인만 로컬에서 쓸 용도라 이 정도로 충분하다는 판단([[학습노트 28번]]와 동일).
// 메인 앱(/)과 링크로 연결하지 않고 주소를 직접 알아야만 오는 별도 라우트로 둠.
export default function AdminLyricsPage() {
  const [secretInput, setSecretInput] = useState("");
  const [adminSecret, setAdminSecret] = useState<string | null>(null);
  const [requests, setRequests] = useState<LyricsRequestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [editing, setEditing] = useState<LyricsRequestItem | null>(null);
  const [plainLyrics, setPlainLyrics] = useState("");
  const [syncedLyrics, setSyncedLyrics] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // 저작권자 삭제 요청(takedown) 대응용 — "가사 올려주세요" 요청 목록과 무관하게, 이미 가사가
  // 떠 있는 아무 곡이나 대상이 될 수 있어서 별도의 아티스트/곡명 직접 입력 폼으로 둠(§44).
  const [takedownArtist, setTakedownArtist] = useState("");
  const [takedownTrack, setTakedownTrack] = useState("");
  const [takedownSubmitting, setTakedownSubmitting] = useState(false);
  const [takedownResult, setTakedownResult] = useState<string | null>(null);

  // 페이지가 처음 뜰 때 세션스토리지에 저장된 비밀번호가 있으면 자동으로 로그인 시도.
  // 값이 있어도 이미 만료/변경됐을 수 있으니 실제 검증은 loadRequests가 API 호출로 함
  // (틀리면 그냥 로그인 화면이 뜨고, 세션스토리지 값도 지움).
  useEffect(() => {
    const saved = sessionStorage.getItem(ADMIN_SECRET_SESSION_KEY);
    if (saved) loadRequests(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRequests(secret: string) {
    setLoading(true);
    setAuthError(null);
    try {
      const data = await getLyricsRequests(secret);
      setRequests(data.requests);
      setAdminSecret(secret);
      sessionStorage.setItem(ADMIN_SECRET_SESSION_KEY, secret);
    } catch {
      setAuthError("비밀번호가 틀렸거나 서버에 연결하지 못했어요.");
      sessionStorage.removeItem(ADMIN_SECRET_SESSION_KEY);
    } finally {
      setLoading(false);
    }
  }

  function openEditor(item: LyricsRequestItem) {
    setEditing(item);
    setPlainLyrics("");
    setSyncedLyrics("");
    setSubmitError(null);
  }

  async function handleSubmitLyrics() {
    if (!adminSecret || !editing || !plainLyrics.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitLyricsOverride(adminSecret, {
        artist: editing.artist,
        track: editing.track,
        plain_lyrics: plainLyrics,
        synced_lyrics: syncedLyrics.trim() || undefined,
      });
      setRequests((prev) => prev.filter((r) => !(r.artist === editing.artist && r.track === editing.track)));
      setEditing(null);
    } catch {
      setSubmitError("등록에 실패했어요. 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTakedown() {
    if (!adminSecret || !takedownArtist.trim() || !takedownTrack.trim()) return;
    setTakedownSubmitting(true);
    setTakedownResult(null);
    try {
      await takedownLyrics(adminSecret, { artist: takedownArtist.trim(), track: takedownTrack.trim() });
      setTakedownResult(`"${takedownArtist} - ${takedownTrack}" 가사를 내렸어요.`);
      setTakedownArtist("");
      setTakedownTrack("");
    } catch {
      setTakedownResult("삭제 요청에 실패했어요. 다시 시도해주세요.");
    } finally {
      setTakedownSubmitting(false);
    }
  }

  if (!adminSecret) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (secretInput.trim()) loadRequests(secretInput.trim());
          }}
          className="w-full max-w-xs rounded-lg border border-white/10 bg-neutral-900 p-5"
        >
          <p className="mb-3 text-sm font-medium">가사 관리자 로그인</p>
          <input
            type="password"
            value={secretInput}
            onChange={(e) => setSecretInput(e.target.value)}
            placeholder="ADMIN_SECRET"
            className="mb-3 w-full rounded-md border border-white/15 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-white/40"
            autoFocus
          />
          {authError && <p className="mb-3 text-xs text-red-400">{authError}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-white py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            {loading ? "확인 중..." : "입장"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 px-6 py-8 text-white">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <p className="text-sm font-medium text-white/80">가사 요청 관리 ({requests.length}건 대기)</p>
          <button
            type="button"
            onClick={() => loadRequests(adminSecret)}
            className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/60 hover:bg-white/10"
          >
            새로고침
          </button>
        </div>

        {/* 저작권자 삭제 요청(notice-and-takedown) 대응용. 요청 목록에 없는 곡(이미 정상적으로
            가사가 떠 있는 곡)도 대상이 될 수 있어서 아티스트/곡명을 직접 입력받음 — 실행하면
            override/캐시가 지워지고 영구 차단 목록에 올라가서 이후 어떤 소스로도 다시 안 뜸. */}
        <div className="mb-6 rounded-md border border-red-500/20 bg-red-500/5 p-3">
          <p className="mb-2 text-xs font-medium text-red-300/80">가사 삭제 (저작권 요청 대응)</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={takedownArtist}
              onChange={(e) => setTakedownArtist(e.target.value)}
              placeholder="아티스트"
              className="w-full rounded-md border border-white/15 bg-neutral-950 px-2 py-1.5 text-xs outline-none focus:border-white/40"
            />
            <input
              type="text"
              value={takedownTrack}
              onChange={(e) => setTakedownTrack(e.target.value)}
              placeholder="곡명"
              className="w-full rounded-md border border-white/15 bg-neutral-950 px-2 py-1.5 text-xs outline-none focus:border-white/40"
            />
            <button
              type="button"
              onClick={handleTakedown}
              disabled={takedownSubmitting || !takedownArtist.trim() || !takedownTrack.trim()}
              className="shrink-0 rounded-md bg-red-500/80 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-40"
            >
              {takedownSubmitting ? "삭제 중..." : "삭제"}
            </button>
          </div>
          {takedownResult && <p className="mt-2 text-xs text-white/50">{takedownResult}</p>}
        </div>

        {requests.length === 0 && (
          <p className="text-sm text-white/40">처리 대기 중인 가사 요청이 없어요.</p>
        )}

        <div className="flex flex-col gap-2">
          {requests.map((item) => (
            <div
              key={`${item.artist}-${item.track}`}
              className="rounded-md border border-white/10 bg-neutral-900 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.track}</p>
                  <p className="truncate text-xs text-white/50">
                    {item.artist} · {item.requestCount}번 요청됨
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openEditor(item)}
                  className="shrink-0 rounded-full border border-white/15 px-3 py-1 text-xs hover:bg-white/10"
                >
                  가사 등록
                </button>
              </div>

              {editing?.artist === item.artist && editing?.track === item.track && (
                <div className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-3">
                  <textarea
                    value={plainLyrics}
                    onChange={(e) => setPlainLyrics(e.target.value)}
                    placeholder="가사 (필수)"
                    rows={6}
                    className="w-full rounded-md border border-white/15 bg-neutral-950 p-2 text-xs outline-none focus:border-white/40"
                  />
                  <textarea
                    value={syncedLyrics}
                    onChange={(e) => setSyncedLyrics(e.target.value)}
                    placeholder="동기화 가사 LRC 형식 (선택, 있으면 하이라이트/자동 스크롤 지원)"
                    rows={6}
                    className="w-full rounded-md border border-white/15 bg-neutral-950 p-2 text-xs outline-none focus:border-white/40"
                  />
                  {submitError && <p className="text-xs text-red-400">{submitError}</p>}
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="rounded-full px-3 py-1 text-xs text-white/50 hover:bg-white/10"
                    >
                      취소
                    </button>
                    <button
                      type="button"
                      onClick={handleSubmitLyrics}
                      disabled={submitting || !plainLyrics.trim()}
                      className="rounded-full bg-white px-3 py-1 text-xs font-medium text-black disabled:opacity-50"
                    >
                      {submitting ? "등록 중..." : "등록"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
