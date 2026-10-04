import type { CapacitorConfig } from '@capacitor/cli';

// 이 앱은 정적 빌드를 번들로 넣는 대신, 실제 배포된 Next.js 서버(Vercel)를 WebView로
// 그대로 열어서 감싸는 방식 — 코드/배포 구조를 새로 안 만들고, "OS가 백그라운드 오디오를
// 허용해주는 껍데기"만 씌우는 게 목적. 예전엔 ngrok 무료 터널(로컬 맥북 서버)을 썼는데,
// Vercel 배포가 끝나서(2026-10-01) 실제 운영 주소로 교체함 — 이제 맥북이 꺼져있어도 앱이 동작함.
// 나중에 커스텀 도메인을 연결하면 그 주소로 다시 바꾸면 됨.
const config: CapacitorConfig = {
  appId: 'com.unbeat.app',
  appName: 'Unbeat',
  webDir: 'public',
  server: {
    url: 'https://unbeat-delta.vercel.app',
  },
};

export default config;
