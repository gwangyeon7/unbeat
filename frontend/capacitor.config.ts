import type { CapacitorConfig } from '@capacitor/cli';

// 이 앱은 정적 빌드를 번들로 넣는 대신, 지금 켜져 있는 Next.js 개발 서버(ngrok 터널)를
// WebView로 그대로 열어서 감싸는 방식 — 코드/배포 구조를 새로 안 만들고, "OS가 백그라운드
// 오디오를 허용해주는 껍데기"만 씌우는 게 목적. 나중에 진짜 배포용 도메인이 생기면 그 주소로
// 바꾸면 됨 (지금은 ngrok 무료 터널이라 서버 껐다 켤 때마다 안 바뀌는지 확인 필요 — §63 참고,
// 같은 예약 도메인이라 보통 안 바뀜).
//
// android: { allowMixedContent: true }는 ngrok 도메인이 https라 사실 필요 없지만, 나중에
// 로컬 IP(http)로 테스트할 일이 생기면 켜야 해서 주석으로만 남겨둠.
const config: CapacitorConfig = {
  appId: 'com.unbeat.app',
  appName: 'Unbeat',
  webDir: 'public',
  server: {
    url: 'https://frenzy-chaste-snowsuit.ngrok-free.dev',
    cleartext: true,
  },
};

export default config;
