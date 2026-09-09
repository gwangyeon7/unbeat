/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lastfm.freetls.fastly.net",
      },
    ],
  },
  // ngrok으로 프론트 하나만 터널링해서 외부(친구 폰)에서 테스트할 때 쓰는 프록시.
  // 브라우저는 이 Next 서버(3000)에만 요청을 보내고, 서버가 내부적으로 같은 맥북 안의
  // 백엔드(8000)/playlist-service(8081)로 다시 전달해준다 — 그래서 백엔드용 ngrok 터널이
  // 따로 필요 없다(무료 ngrok은 동시 터널 1개만 지원해서 이 방식으로 우회함).
  async rewrites() {
    return [
      { source: "/proxy/py/:path*", destination: "http://127.0.0.1:8000/:path*" },
      { source: "/proxy/playlist/:path*", destination: "http://127.0.0.1:8081/:path*" },
    ];
  },
};

export default nextConfig;
