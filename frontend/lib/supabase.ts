import { createClient, type Session } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// 로그인은 선택 기능이라(ROADMAP 5-2 결정, 2026-10-07) 환경변수가 비어있어도 앱 전체가
// 죽으면 안 됨 — 값이 없으면 null을 두고, 로그인 관련 UI/호출 쪽에서 그 경우를 감안해 처리함.
export const supabase =
  SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
    : null;

/**
 * 로그인 상태면 Supabase가 발급한 access_token(JWT)을, 비로그인이면 null을 반환.
 * lib/api.ts의 fetchJson이 이 값을 Authorization 헤더로 붙여서 백엔드에 "누가 요청했는지"를
 * 알려줌 — 비로그인 사용자는 기존처럼 X-Session-Id만으로 계속 동작(선택적 인증).
 */
export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export type { Session };
