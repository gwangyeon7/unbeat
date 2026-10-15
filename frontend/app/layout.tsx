import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Unbeat",
  description: "아티스트를 검색하고 새로운 음악을 발견하는 서비스",
  // (아이폰 홈 화면 추가 대응, 2026-10-15) 홈 화면에 추가해서 열면 Safari 주소창/하단 바 없이
  // 전체 화면 앱처럼 뜨게 함 — "Safari 전용 바가 자리를 너무 차지한다"는 피드백. 일반 Safari
  // 탭으로 열었을 땐 브라우저 바를 코드로 숨길 수 없어서(iOS 정책) 이 방식이 유일한 방법임.
  appleWebApp: {
    capable: true,
    title: "Unbeat",
    statusBarStyle: "black",
  },
};

// (버그 수정, 2026-10-15) iOS Safari는 글자 크기 16px 미만인 입력창에 포커스하면 화면을 자동
// 확대하고 그대로 둠 — 검색창을 열었을 때 화면이 옆으로 밀려 보이던 원인. 확대 자체를 막음.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0b0b0f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
