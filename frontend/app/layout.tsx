import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Unbeat",
  description: "아티스트를 검색하고 새로운 음악을 발견하는 서비스",
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
