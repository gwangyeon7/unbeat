"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

// (2026-10-22, 피드백) 홈 화면에 설치한 앱에서 구글 로그인(OAuth 리다이렉트)을 하면 앱을 벗어나
// 삼성 인터넷 같은 브라우저로 빠져서, 앱이 아니라 브라우저 화면(하단바 3겹)이 돼버림. 리다이렉트
// 없이 이 화면 안에서 끝나는 Google Identity Services(GIS)로 받은 ID 토큰을 Supabase에 넘겨서
// 로그인함(signInWithIdToken). NEXT_PUBLIC_GOOGLE_CLIENT_ID가 없으면 예전 리다이렉트 방식으로 폴백.
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

function loadGisScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).google?.accounts?.id) return resolve();
    const existing = document.querySelector(`script[src="${GIS_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("gis load failed")));
      return;
    }
    const s = document.createElement("script");
    s.src = GIS_SCRIPT_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("gis load failed"));
    document.head.appendChild(s);
  });
}

type AuthModalProps = {
  onClose: () => void;
  // 로그인/회원가입 성공 시 호출 — page.tsx가 이걸로 상단 헤더의 로그인 버튼 상태를 바꿈.
  onAuthSuccess: () => void;
};

// 이메일/비번 로그인 모달(ROADMAP 5-2 결정) + 구글 로그인(2026-10-14 추가, 범위 밖이던
// OAuth를 재논의해서 승인받음). 로그인은 선택 기능이라(비로그인도 기존처럼 전부 동작) 이
// 모달을 안 열면 아무 영향 없음 — AddToPlaylistModal과 같은 패턴(화면 중앙 모달, z-50)으로 통일.
export default function AuthModal({ onClose, onAuthSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupDone, setSignupDone] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const [gisReady, setGisReady] = useState(false);
  // (2026-10-22 실기기 확인) 홈 화면에 설치한 앱(standalone/fullscreen)에서는 구글 로그인이 앱을 벗어나
  // 삼성 인터넷 등 브라우저로 빠지거나(리다이렉트 방식), 팝업이 결과를 앱으로 못 돌려줘서 빈 화면에서
  // 멈춤(GIS 팝업 방식) — 구글이 임베디드/설치형 웹앱의 OAuth를 제한하는 동작이라 코드로 우회가
  // 어려움. 그래서 설치형 앱에서는 구글 로그인을 숨기고 이메일 로그인만 보여줌(브라우저 접속은 그대로).
  const [isInstalledApp, setIsInstalledApp] = useState(false);
  useEffect(() => {
    const mq = ["standalone", "fullscreen", "minimal-ui"].some(
      (m) => window.matchMedia(`(display-mode: ${m})`).matches
    );
    const iosStandalone = (window.navigator as any).standalone === true;
    setIsInstalledApp(mq || iosStandalone);
  }, []);

  // GIS 버튼: 구글이 그려주는 공식 로그인 버튼을 띄우고, 로그인되면 callback으로 ID 토큰(credential)이 옴.
  // 설치형 앱에서는 팝업 버튼 대신 FedCM(브라우저 내장 계정 선택창) 기반 prompt()를 직접 호출함 —
  // 팝업/리다이렉트가 없어서 앱 안에서 끝날 수 있는지 시험하는 방식(실기기 확인 필요).
  const [isInstalledChecked, setIsInstalledChecked] = useState(false);
  useEffect(() => {
    setIsInstalledChecked(true);
  }, [isInstalledApp]);
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !supabase || !isInstalledChecked) return;
    let cancelled = false;
    loadGisScript()
      .then(() => {
        if (cancelled) return;
        if (!isInstalledApp && !googleButtonRef.current) return;
        const google = (window as any).google;
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          use_fedcm_for_prompt: true,
          use_fedcm_for_button: true,
          button_auto_select: false,
          callback: async (response: { credential: string }) => {
            setIsGoogleLoading(true);
            setError(null);
            const { error: idTokenError } = await supabase!.auth.signInWithIdToken({
              provider: "google",
              token: response.credential,
            });
            setIsGoogleLoading(false);
            if (idTokenError) {
              setError("구글 로그인에 실패했어요. 잠시 후 다시 시도해주세요.");
              return;
            }
            onAuthSuccess();
            onClose();
          },
        });
        if (!isInstalledApp && googleButtonRef.current) {
          google.accounts.id.renderButton(googleButtonRef.current, {
            theme: "filled_black",
            size: "large",
            text: "continue_with",
            shape: "rectangular",
            width: 280,
            locale: "ko",
          });
        }
        setGisReady(true);
      })
      .catch(() => {
        // 스크립트를 못 불러오면(오프라인/차단) 예전 리다이렉트 버튼이 그대로 보임
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInstalledChecked, isInstalledApp]);

  // 설치형 앱 전용: FedCM 계정 선택창 띄우기. 안 뜨면(차단/미지원) 이유를 안내.
  function handleInstalledGoogle() {
    const google = (window as any).google;
    if (!google?.accounts?.id) {
      setError("구글 로그인을 불러오지 못했어요. 이메일로 로그인해주세요.");
      return;
    }
    setError(null);
    google.accounts.id.prompt((n: any) => {
      if (n.isNotDisplayed?.() || n.isSkippedMoment?.()) {
        setError("이 앱에서는 구글 계정 선택창을 못 띄웠어요. 이메일로 로그인하거나 브라우저(unbeat.org)에서 구글로 로그인해주세요.");
      }
    });
  }

  // (구글 로그인, 2026-10-14) OAuth는 이메일/비번과 달리 즉시 세션을 안 주고 구글 로그인
  // 화면으로 리다이렉트했다가 돌아오는 방식 — 그래서 이 함수가 끝나도 onAuthSuccess()를
  // 직접 호출하지 않음(아직 로그인 전). 돌아온 뒤 세션 반영은 page.tsx의 onAuthStateChange
  // 구독이 이미 처리하고 있어서(로그인 방식과 무관하게 동작) 추가 배관공사 불필요. Supabase
  // 쪽에 구글 Provider(클라이언트 ID/시크릿)가 등록·활성화돼 있어야 동작함 — 안 돼 있으면
  // Supabase가 에러를 던짐.
  async function handleGoogleSignIn() {
    if (!supabase) {
      setError("로그인 기능이 아직 설정되지 않았어요.");
      return;
    }
    setIsGoogleLoading(true);
    setError(null);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (oauthError) {
      setIsGoogleLoading(false);
      setError("구글 로그인을 시작하지 못했어요.");
    }
    // 성공 시엔 브라우저가 바로 구글 로그인 페이지로 이동하므로 이 함수의 나머지 코드는
    // 실행될 일이 거의 없음(페이지 이탈) — isGoogleLoading을 계속 true로 둬도 무해함.
  }
  // "Confirm email"이 켜진 Supabase 프로젝트에선 signUp()이 계정은 만들어도 세션은 안 줌
  // (이메일 인증 전까진 로그인 불가) — 이 경우와 "진짜 바로 로그인됨"을 구분해서 보여주려고 추가.
  // 전엔 이 구분 없이 무조건 "바로 로그인됐어요"로 띄워서, 실제로는 로그인 안 된 사용자가
  // 로그인된 줄 알고 혼란스러워하는 버그가 있었음(2026-10-08 실사용 중 발견).
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setError("로그인 기능이 아직 설정되지 않았어요.");
      return;
    }
    setIsSubmitting(true);
    setError(null);

    if (mode === "signin") {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      setIsSubmitting(false);
      if (signInError) {
        // Supabase가 "이메일 미인증"일 때 주는 실제 사유를 그대로 구분해서 보여줌 —
        // 이전엔 이것도 "이메일/비밀번호가 틀렸다"로 뭉뚱그려서, 진짜 원인(인증 안 함)을
        // 못 찾고 계속 재시도하게 만드는 문제가 있었음.
        setError(
          signInError.message.toLowerCase().includes("email not confirmed")
            ? "이메일 인증이 아직 안 됐어요. 가입할 때 받은 메일함에서 인증 링크를 먼저 눌러주세요."
            : "이메일 또는 비밀번호가 올바르지 않아요."
        );
        return;
      }
      onAuthSuccess();
      onClose();
    } else {
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({ email, password });
      setIsSubmitting(false);
      if (signUpError) {
        setError(signUpError.message.includes("already registered")
          ? "이미 가입된 이메일이에요."
          : "회원가입에 실패했어요. 비밀번호는 6자 이상이어야 해요.");
        return;
      }
      setSignupDone(true);
      if (signUpData.session) {
        // "Confirm email"이 꺼진 설정 — 가입과 동시에 세션이 바로 생겨 진짜 로그인 상태가 됨.
        onAuthSuccess();
      } else {
        // 세션이 없음 = 이메일 인증 대기 상태. 아직 로그인된 게 아니므로 onAuthSuccess를
        // 호출하지 않음(호출하면 로그인 안 된 상태인데 헤더가 로그인된 것처럼 바뀔 수 있어서).
        setNeedsEmailConfirmation(true);
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-white/10 bg-neutral-900 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold">
            {mode === "signin" ? "로그인" : "회원가입"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="shrink-0 rounded-full p-1 text-white/50 hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        {signupDone ? (
          <div className="py-2 text-sm text-white/70">
            {needsEmailConfirmation
              ? "가입 신청은 됐는데, 이메일 인증이 아직 필요해요 — 받은 메일함(스팸함도 확인)에서 인증 링크를 눌러야 로그인할 수 있어요."
              : "가입이 완료됐어요. 바로 로그인됐어요 — 창을 닫고 계속 이용하면 돼요."}
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-black"
            >
              닫기
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {isInstalledApp && GOOGLE_CLIENT_ID && (
              <button
                type="button"
                disabled={!gisReady}
                onClick={handleInstalledGoogle}
                className="flex items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium hover:bg-white/10 disabled:opacity-50"
              >
                구글로 계속하기
              </button>
            )}
            {GOOGLE_CLIENT_ID && !isInstalledApp && (
              <div ref={googleButtonRef} className="flex min-h-[40px] justify-center" />
            )}
            <button
              type="button"
              disabled={isGoogleLoading}
              onClick={handleGoogleSignIn}
              className={`flex items-center justify-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium hover:bg-white/10 disabled:opacity-50 ${
                isInstalledApp || (GOOGLE_CLIENT_ID && gisReady) ? "hidden" : ""
              }`}
            >
              <svg viewBox="0 0 48 48" className="h-4 w-4" aria-hidden="true">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.8 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.2 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.2 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.2C29.3 35.4 26.8 36 24 36c-5.2 0-9.7-3.3-11.3-7.9l-6.6 5.1C9.5 39.6 16.2 44 24 44z"/>
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.9 2.5-2.6 4.6-4.9 6l6.2 5.2C40.1 36.5 44 30.8 44 24c0-1.3-.1-2.7-.4-3.5z"/>
              </svg>
              {isGoogleLoading ? "이동 중..." : "구글로 계속하기"}
            </button>
            <div className="flex items-center gap-2 text-[11px] text-white/30">
              <div className="h-px flex-1 bg-white/10" />
              또는
              <div className="h-px flex-1 bg-white/10" />
            </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="이메일"
              className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호 (6자 이상)"
              className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-accent"
            />
            {error && <p className="text-xs text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-black disabled:opacity-50"
            >
              {isSubmitting ? "처리 중..." : mode === "signin" ? "로그인" : "회원가입"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode(mode === "signin" ? "signup" : "signin");
                setError(null);
              }}
              className="text-xs text-white/50 hover:text-white/80"
            >
              {mode === "signin" ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인"}
            </button>
          </form>
          </div>
        )}
      </div>
    </div>
  );
}
