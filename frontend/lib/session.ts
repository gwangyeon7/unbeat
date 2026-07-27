const SESSION_KEY = "unbeat_session_id";

/**
 * 로그인이 없는 서비스라 익명 사용자를 구분하기 위한 세션ID.
 * 브라우저 localStorage에 한 번 만들어두고 계속 재사용한다.
 * (GA4의 client_id와 같은 개념 — AARRR/코호트 분석에서 "사용자" 단위로 씀)
 */
export function getSessionId(): string {
  if (typeof window === "undefined") {
    return "server";
  }

  let sessionId = localStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, sessionId);
  }
  return sessionId;
}
