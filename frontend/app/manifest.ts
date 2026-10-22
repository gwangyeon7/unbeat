import type { MetadataRoute } from "next";

// 홈 화면에 추가했을 때 주소창 없는 전체 화면(standalone) 앱으로 뜨게 하는 웹 앱 매니페스트.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Unbeat",
    short_name: "Unbeat",
    start_url: "/",
    // (2026-10-22) 갤럭시 하단 내비게이션 바/상태바까지 숨기고 우리 하단 탭바만 보이게 전체화면으로
    // 시도 — 지원 안 하는 환경에선 display_override 순서대로 standalone으로 자동 폴백. 이미 설치한
    // 홈 화면 앱은 매니페스트가 갱신되지 않을 수 있어서, 반영하려면 앱을 지우고 다시 설치해야 함.
    display: "standalone",
    display_override: ["fullscreen", "standalone"],
    background_color: "#0b0b0f",
    theme_color: "#0b0b0f",
  };
}
