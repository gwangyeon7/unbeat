import type { MetadataRoute } from "next";

// 홈 화면에 추가했을 때 주소창 없는 전체 화면(standalone) 앱으로 뜨게 하는 웹 앱 매니페스트.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Unbeat",
    short_name: "Unbeat",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0b0f",
    theme_color: "#0b0b0f",
  };
}
