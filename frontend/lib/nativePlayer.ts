import { Capacitor, registerPlugin } from "@capacitor/core";

// (§73) 안드로이드 백그라운드 재생 재설계 — 자세한 배경은 LEARNING_NOTES.md §72/§73 참고.
// 요약: 화면에 보이는 웹뷰(액티비티)에서 유튜브 iframe을 직접 재생하면, 홈 버튼을 눌러
// 액티비티가 onStop()으로 넘어가는 순간 렌더링 서피스가 정리되면서 오디오 스트림까지
// 같이 끊긴다는 걸 Logcat으로 실측 확인함(포그라운드 서비스/알림 권한을 다 고쳐도 안 됨).
// 그래서 실제 재생은 네이티브 포그라운드 서비스(PlaybackService.java)가 소유한, 액티비티
// 생명주기와 분리된 별도의 "안 보이는" 웹뷰에서 하도록 옮기고, 이 파일은 그 서비스를
// 원격 조종하는 Capacitor 플러그인(PlaybackPlugin.java)을 감싸서 MiniPlayer.tsx가
// 기존 YT.Player 객체를 쓰던 것과 최대한 같은 모양(playVideo/pauseVideo/seekTo/...)의
// 프록시 객체로 노출함 — MiniPlayer.tsx 쪽 변경을 최소화하기 위함.

interface PlaybackBridgePlugin {
  loadAndPlay(options: { videoId: string; title?: string; artist?: string }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekTo(options: { seconds: number }): Promise<void>;
  setVolume(options: { volume: number }): Promise<void>;
  mute(): Promise<void>;
  unmute(): Promise<void>;
  // (§73 후속) 화면 꺼짐 상태에서도 다음 곡으로 자동전환되도록, videoId까지 이미 resolve된
  // "다음 곡 미리보기"를 헤드리스 웹뷰에 미리 넘겨둠. 자세한 배경은 LEARNING_NOTES.md §73 참고.
  setQueue(options: { tracks: { videoId: string; title: string; artist: string }[] }): Promise<void>;
  addListener(
    eventName: "ready" | "stateChange" | "timeUpdate" | "autoAdvance",
    callback: (data: any) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

// 웹(브라우저)에서는 이 플러그인 자체가 존재하지 않으므로, 반드시 안드로이드 네이티브
// 앱에서 실행 중일 때만 켜야 함 — 아닌 경우 기존 방식(웹뷰 안 유튜브 iframe)을 그대로 씀.
export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

let bridge: PlaybackBridgePlugin | null = null;
function getBridge(): PlaybackBridgePlugin {
  if (!bridge) {
    bridge = registerPlugin<PlaybackBridgePlugin>("PlaybackBridge");
  }
  return bridge;
}

export type NativePlayerEvent = { data: number; target: NativePlayerHandle };
export type NativePlayerCallbacks = {
  onReady: (e: { target: NativePlayerHandle }) => void;
  onStateChange: (e: NativePlayerEvent) => void;
  // (§73 후속) 화면 꺼짐 상태에서 헤드리스 웹뷰가 액티비티 웹뷰를 거치지 않고 스스로 다음
  // 곡으로 넘어갔을 때 호출됨 — MiniPlayer.tsx가 이걸로 UI/상위(page.tsx) 상태를 실제
  // 재생 중인 곡과 다시 맞춤.
  onAutoAdvance?: (data: { videoId: string; title: string; artist: string }) => void;
};

export type NativePlayerHandle = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number) => void;
  setVolume: (v: number) => void;
  mute: () => void;
  unMute: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  loadVideoById: (videoId: string, title?: string, artist?: string) => void;
  setQueue: (tracks: { videoId: string; title: string; artist: string }[]) => void;
  destroy: () => void;
};

/**
 * PlaybackService(네이티브)를 원격 조종하는 프록시. 실제 유튜브 iframe/오디오는
 * 이 객체 안이 아니라 안드로이드 쪽 헤드리스 웹뷰 안에 있음 — 여기서는 상태를
 * 로컬에 캐시해뒀다가 getCurrentTime()/getDuration() 호출에 그대로 답해줌.
 */
export function createNativePlayer(
  videoId: string,
  title: string,
  artist: string,
  callbacks: NativePlayerCallbacks
): NativePlayerHandle {
  const b = getBridge();
  let duration = 0;
  let currentTime = 0;
  // (곡 전환 알림 텍스트 고정 버그 수정) loadVideoById가 매번 새 title/artist를 받을 수
  // 있도록, 생성 시점 값을 파라미터가 아니라 이 클로저 안의 변수로 옮겨서 갱신 가능하게 함.
  let currentTitle = title;
  let currentArtist = artist;
  const handles: Array<{ remove: () => Promise<void> }> = [];

  const target: NativePlayerHandle = {
    playVideo: () => {
      b.play();
    },
    pauseVideo: () => {
      b.pause();
    },
    seekTo: (seconds: number) => {
      b.seekTo({ seconds });
      currentTime = seconds;
    },
    setVolume: (v: number) => {
      b.setVolume({ volume: v });
    },
    mute: () => {
      b.mute();
    },
    unMute: () => {
      b.unmute();
    },
    getCurrentTime: () => currentTime,
    getDuration: () => duration,
    loadVideoById: (id: string, newTitle?: string, newArtist?: string) => {
      currentTime = 0;
      if (newTitle !== undefined) currentTitle = newTitle;
      if (newArtist !== undefined) currentArtist = newArtist;
      b.loadAndPlay({ videoId: id, title: currentTitle, artist: currentArtist });
    },
    setQueue: (tracks: { videoId: string; title: string; artist: string }[]) => {
      b.setQueue({ tracks });
    },
    destroy: () => {
      handles.forEach((h) => h.remove());
    },
  };

  b.addListener("ready", (data: any) => {
    duration = typeof data?.duration === "number" ? data.duration : 0;
    callbacks.onReady({ target });
  }).then((h) => handles.push(h));

  b.addListener("stateChange", (data: any) => {
    if (typeof data?.duration === "number") duration = data.duration;
    callbacks.onStateChange({ data: data?.state, target });
  }).then((h) => handles.push(h));

  b.addListener("timeUpdate", (data: any) => {
    if (typeof data?.currentTime === "number") currentTime = data.currentTime;
  }).then((h) => handles.push(h));

  b.addListener("autoAdvance", (data: any) => {
    if (typeof data?.videoId === "string") {
      currentTime = 0;
      currentTitle = typeof data?.title === "string" ? data.title : currentTitle;
      currentArtist = typeof data?.artist === "string" ? data.artist : currentArtist;
      callbacks.onAutoAdvance?.({ videoId: data.videoId, title: currentTitle, artist: currentArtist });
    }
  }).then((h) => handles.push(h));

  b.loadAndPlay({ videoId, title, artist });

  return target;
}
