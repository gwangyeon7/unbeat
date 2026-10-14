"use client";

import { useEffect, useState } from "react";
import {
  getNextTrackOverrides,
  submitNextTracksOverride,
  deleteNextTracksOverride,
  type NextTrackOverrideEntry,
} from "@/lib/api";

// /admin/lyrics와 같은 세션스토리지 키를 그대로 재사용 — 같은 ADMIN_SECRET이라 두 관리자
// 페이지를 오갈 때 비밀번호를 또 칠 필요가 없게 함.
const ADMIN_SECRET_SESSION_KEY = "unbeat-admin-secret";

type NextTrackRow = { artist: string; track: string };

const emptyRow = (): NextTrackRow => ({ artist: "", track: "" });

// (§83) "다음 트랙" 수작업 매핑 관리자 화면. 가사 관리자 화면(/admin/lyrics)과 같은 성격 —
// 오디오 분석/협업 필터링이 라이선스·데이터 문제로 막혀있어서, "이 곡 다음엔 이 곡을 틀어라"를
// 운영자가 직접 입력해서 등록해둠. 외부 API를 아예 안 거치니 Last.fm/ListenBrainz가 둘 다
// 얇은(§82) 인디 곡에서도 장르 불일치가 원천적으로 안 생김. 오디오 파일은 전혀 안 건드리고
// 텍스트(아티스트/곡명) 쌍만 저장 — 재생 자체는 그대로 유튜브 임베드가 담당함.
// /admin/lyrics와 마찬가지로 메인 앱과 링크로 연결하지 않고 주소를 직접 알아야만 오는 라우트.
export default function AdminNextTracksPage() {
  const [secretInput, setSecretInput] = useState("");
  const [adminSecret, setAdminSecret] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<NextTrackOverrideEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [sourceArtist, setSourceArtist] = useState("");
  const [sourceTrack, setSourceTrack] = useState("");
  const [rows, setRows] = useState<NextTrackRow[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitDone, setSubmitDone] = useState<string | null>(null);

  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem(ADMIN_SECRET_SESSION_KEY);
    if (saved) loadOverrides(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadOverrides(secret: string) {
    setLoading(true);
    setAuthError(null);
    try {
      const data = await getNextTrackOverrides(secret);
      setOverrides(data.overrides);
      setAdminSecret(secret);
      sessionStorage.setItem(ADMIN_SECRET_SESSION_KEY, secret);
    } catch {
      setAuthError("비밀번호가 틀렸거나 서버에 연결하지 못했어요.");
      sessionStorage.removeItem(ADMIN_SECRET_SESSION_KEY);
    } finally {
      setLoading(false);
    }
  }

  function updateRow(index: number, field: "artist" | "track", value: string) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function resetForm() {
    setSourceArtist("");
    setSourceTrack("");
    setRows([emptyRow(), emptyRow(), emptyRow()]);
  }

  async function handleSubmit() {
    if (!adminSecret || !sourceArtist.trim() || !sourceTrack.trim()) return;
    const nextTracks = rows
      .map((r) => ({ artist: r.artist.trim(), track: r.track.trim() }))
      .filter((r) => r.artist && r.track);
    if (nextTracks.length === 0) {
      setSubmitError("다음 트랙을 최소 1개 이상 입력해주세요.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    setSubmitDone(null);
    try {
      await submitNextTracksOverride(adminSecret, {
        artist: sourceArtist.trim(),
        track: sourceTrack.trim(),
        next_tracks: nextTracks,
      });
      setSubmitDone(`"${sourceArtist} - ${sourceTrack}" 다음 트랙 ${nextTracks.length}곡 등록했어요.`);
      resetForm();
      loadOverrides(adminSecret);
    } catch {
      setSubmitError("등록에 실패했어요. 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(entry: NextTrackOverrideEntry) {
    if (!adminSecret) return;
    const key = `${entry.artist}-${entry.track}`;
    setDeletingKey(key);
    try {
      await deleteNextTracksOverride(adminSecret, { artist: entry.artist, track: entry.track });
      setOverrides((prev) => prev.filter((o) => !(o.artist === entry.artist && o.track === entry.track)));
    } catch {
      // 실패하면 목록을 다시 불러와서 실제 상태와 어긋나지 않게 함
      loadOverrides(adminSecret);
    } finally {
      setDeletingKey(null);
    }
  }

  function editExisting(entry: NextTrackOverrideEntry) {
    setSourceArtist(entry.artist);
    setSourceTrack(entry.track);
    const existingRows = entry.nextTracks.map((t) => ({ artist: t.artist, track: t.track }));
    setRows(existingRows.length > 0 ? existingRows : [emptyRow(), emptyRow(), emptyRow()]);
    setSubmitDone(null);
    setSubmitError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (!adminSecret) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-white">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (secretInput.trim()) loadOverrides(secretInput.trim());
          }}
          className="w-full max-w-xs rounded-lg border border-white/10 bg-neutral-900 p-5"
        >
          <p className="mb-3 text-sm font-medium">다음 트랙 관리자 로그인</p>
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
          <p className="text-sm font-medium text-white/80">다음 트랙 수작업 매핑 ({overrides.length}건 등록됨)</p>
          <button
            type="button"
            onClick={() => loadOverrides(adminSecret)}
            className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/60 hover:bg-white/10"
          >
            새로고침
          </button>
        </div>

        {/* 등록/수정 폼 */}
        <div className="mb-6 rounded-md border border-white/10 bg-neutral-900 p-4">
          <p className="mb-3 text-xs font-medium text-white/80">이 곡이 재생 중일 때</p>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={sourceArtist}
              onChange={(e) => setSourceArtist(e.target.value)}
              placeholder="아티스트 (예: Bolbbalgan4)"
              className="w-full rounded-md border border-white/15 bg-neutral-950 px-2 py-1.5 text-xs outline-none focus:border-white/40"
            />
            <input
              type="text"
              value={sourceTrack}
              onChange={(e) => setSourceTrack(e.target.value)}
              placeholder="곡명 (예: 여행)"
              className="w-full rounded-md border border-white/15 bg-neutral-950 px-2 py-1.5 text-xs outline-none focus:border-white/40"
            />
          </div>

          <p className="mb-2 text-xs font-medium text-white/80">다음 트랙으로 (순서대로 재생됨)</p>
          <div className="mb-3 flex flex-col gap-2">
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-4 shrink-0 text-right text-[10px] text-white/30">{i + 1}</span>
                <input
                  type="text"
                  value={row.artist}
                  onChange={(e) => updateRow(i, "artist", e.target.value)}
                  placeholder="아티스트"
                  className="w-full rounded-md border border-white/15 bg-neutral-950 px-2 py-1.5 text-xs outline-none focus:border-white/40"
                />
                <input
                  type="text"
                  value={row.track}
                  onChange={(e) => updateRow(i, "track", e.target.value)}
                  placeholder="곡명"
                  className="w-full rounded-md border border-white/15 bg-neutral-950 px-2 py-1.5 text-xs outline-none focus:border-white/40"
                />
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  disabled={rows.length <= 1}
                  className="shrink-0 rounded-md px-2 py-1.5 text-xs text-white/40 hover:bg-white/10 disabled:opacity-30"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addRow}
            className="mb-3 rounded-full border border-white/15 px-3 py-1 text-xs text-white/60 hover:bg-white/10"
          >
            + 곡 추가
          </button>

          {submitError && <p className="mb-2 text-xs text-red-400">{submitError}</p>}
          {submitDone && <p className="mb-2 text-xs text-emerald-400">{submitDone}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={resetForm}
              className="rounded-full px-3 py-1 text-xs text-white/50 hover:bg-white/10"
            >
              초기화
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !sourceArtist.trim() || !sourceTrack.trim()}
              className="rounded-full bg-white px-3 py-1 text-xs font-medium text-black disabled:opacity-50"
            >
              {submitting ? "등록 중..." : "등록"}
            </button>
          </div>
        </div>

        {/* 기존 등록 목록 */}
        {overrides.length === 0 && (
          <p className="text-sm text-white/40">아직 등록된 매핑이 없어요.</p>
        )}
        <div className="flex flex-col gap-2">
          {overrides.map((entry) => (
            <div
              key={`${entry.artist}-${entry.track}`}
              className="rounded-md border border-white/10 bg-neutral-900 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{entry.track}</p>
                  <p className="truncate text-xs text-white/50">
                    {entry.artist} · 다음 트랙 {entry.nextTracks.length}곡
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => editExisting(entry)}
                    className="rounded-full border border-white/15 px-3 py-1 text-xs hover:bg-white/10"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(entry)}
                    disabled={deletingKey === `${entry.artist}-${entry.track}`}
                    className="rounded-full border border-red-500/30 px-3 py-1 text-xs text-red-300/80 hover:bg-red-500/10 disabled:opacity-40"
                  >
                    삭제
                  </button>
                </div>
              </div>
              <p className="mt-2 truncate text-xs text-white/40">
                {entry.nextTracks.map((t) => `${t.artist} - ${t.track}`).join(" / ")}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
