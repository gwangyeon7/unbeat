"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// 비밀번호 재설정 메일의 링크로 들어오는 페이지. Supabase가 URL의 토큰으로 임시 세션을 만들면
// (PASSWORD_RECOVERY 이벤트) 새 비밀번호를 받아 updateUser로 바꿈.
export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data: s }) => {
      if (s.session) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setIsSubmitting(true);
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setIsSubmitting(false);
    if (updateError) {
      setError("비밀번호를 바꾸지 못했어요. 6자 이상인지 확인하거나, 메일 링크를 다시 받아주세요.");
      return;
    }
    setDone(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-white/10 bg-neutral-900 p-5">
        <h1 className="mb-4 text-base font-semibold">비밀번호 재설정</h1>
        {done ? (
          <div className="flex flex-col gap-3 text-sm text-white/70">
            비밀번호를 바꿨어요. 이제 로그인된 상태예요.
            <a href="/" className="rounded-md bg-accent px-3 py-2 text-center font-medium text-black">
              Unbeat로 돌아가기
            </a>
          </div>
        ) : !ready ? (
          <p className="text-sm text-white/60">
            메일의 재설정 링크로 들어와야 해요. 링크가 만료됐다면 로그인 화면에서 다시 요청해주세요.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="password"
              required
              minLength={6}
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="새 비밀번호 (6자 이상)"
              className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-accent"
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-black disabled:opacity-50"
            >
              {isSubmitting ? "처리 중..." : "비밀번호 바꾸기"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
