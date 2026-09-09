"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Track, LyricsResult } from "@/lib/api";
import { getLyrics, requestLyrics, searchYoutubeVideo } from "@/lib/api";
import { isNativeAndroid, createNativePlayer } from "@/lib/nativePlayer";

export type NowPlayingTrack = {
  videoId: string;
  name: string;
  artist: string;
  image: string | null;
};

type MiniPlayerProps = {
  track: NowPlayingTrack;
  onClose: () => void;
  // 재생 버튼을 누른 시점이 아니라, 유튜브 플레이어가 실제로 PLAYING 상태에 들어간 순간(=진짜 소리가
  // 나기 시작한 순간) 호출됨. lastOpenedAt 기록을 여기로 옮겨서 신호 정확도를 한 단계 더 높임.
  onActuallyPlaying?: () => void;
  // 곡이 끝(YT.PlayerState.ENDED)까지 재생됐을 때 호출 — page.tsx가 이 시점에 큐의 다음 곡을 재생함.
  // "유튜브 뮤직처럼 곡 끝나면 비슷한 곡이 자동으로 이어졌으면 좋겠다"는 피드백으로 추가.
  onEnded?: () => void;
  // 스포티파이/유튜브 뮤직처럼 재생바에서 바로 즐겨찾기 토글까지 되게 함 (선택적 — 즐겨찾기
  // 서비스가 꺼져있어도 재생 자체는 그대로 동작해야 하니 optional로 둠)
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  // "다음 트랙" 큐 — 지금 곡과 비슷한 곡 목록(GET /similar-tracks). 눌러서 펼쳐볼 수 있고,
  // 곡을 직접 클릭하면 그 자리에서 바로 재생으로 넘어감.
  queue?: Track[];
  onSelectQueueTrack?: (track: Track) => void;
  // 유튜브 뮤직의 "다음 트랙 전체를 재생목록에 저장" 버튼을 참고해서 추가 — 큐에 있는 곡을
  // 하나씩 담을 필요 없이 지금 뜬 목록 전체를 한 번에 재생목록에 옮길 수 있게 함.
  onSaveQueueToPlaylist?: (tracks: Track[]) => void;
  // (§73 후속) 안드로이드 네이티브 경로에서, 화면 꺼짐 때문에 이 화면의 JS가 못 도는 동안
  // 헤드리스 웹뷰가 스스로 다음 곡으로 넘어갔을 때 호출됨 — page.tsx가 handleTrackEnded와
  // 같은 큐 소비 로직을 native가 이미 재생 중인 곡 기준으로 다시 실행하도록 함.
  onNativeAutoAdvance?: (data: { videoId: string; title: string; artist: string }) => void;
};

// YouTube IFrame Player API는 <script> 태그로 전역에 한 번만 로드하면 됨.
// 여러 번 재생 버튼을 눌러도 스크립트를 중복 삽입하지 않도록 Promise를 모듈 스코프에 캐싱.
let youtubeApiPromise: Promise<void> | null = null;
function loadYoutubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if ((window as any).YT?.Player) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve) => {
    const prevCallback = (window as any).onYouTubeIframeAPIReady;
    (window as any).onYouTubeIframeAPIReady = () => {
      prevCallback?.();
      resolve();
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.body.appendChild(script);
  });
  return youtubeApiPromise;
}

// "관련 항목"(유사 아티스트 인기곡) 탭은 "다음 트랙"(유사 곡 큐)과 너무 비슷하다는 피드백으로
// 제거함 — 자세한 경위는 [[학습노트 35번]] 참고.
type ExpandedTab = "queue" | "lyrics";

// 유튜브 IFrame API의 YT.PlayerState 값을 그대로 하드코딩 — 안드로이드 네이티브 경로(§73)에서는
// window.YT 자체를 이 화면(액티비티 웹뷰)에 안 띄우므로 window.YT.PlayerState를 못 읽음. 이
// 값들은 유튜브 공개 API 계약상 안정적으로 고정된 값이라 하드코딩해도 안전함.
const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

type LyricLine = { time: number; text: string };

// LRCLIB의 syncedLyrics는 "[mm:ss.xx] 가사" 형식(LRC 포맷) 한 줄씩 이어붙인 문자열 —
// 초 단위 숫자로 파싱해서 재생 위치(currentTime)와 비교할 수 있게 함.
function parseSyncedLyrics(synced: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of synced.split("\n")) {
    const match = raw.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s?(.*)$/);
    if (!match) continue;
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    const text = match[3].trim();
    if (text.length === 0) continue;
    lines.push({ time: minutes * 60 + seconds, text });
  }
  return lines;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// 네이티브 <input type="range"> 기본 스타일(특히 accent-color만 줬을 때 뜨는 큼직한 원형 손잡이)이
// "짜치다"는 피드백을 받고, 진행바/볼륨바 둘 다 얇은 트랙 + 작은 손잡이로 직접 다듬은 공통 스타일.
//
// (모바일 드래그 안 되는 문제 수정) 처음엔 <input> 자체의 높이를 h-1(4px)로 얇게 잡고 그
// 배경색으로 트랙을 그렸는데, 그러면 실제 터치 히트 영역도 똑같이 4px로 줄어들어서 손가락으로
// 정확히 그 얇은 줄 위를 짚어야만 드래그가 시작됨(폰에서 거의 안 먹힘 — 데스크톱 마우스는
// 커서가 정확하니 문제가 안 드러났던 것). 이제 <input> 자체는 h-6(24px)의 투명한 터치 영역으로
// 두고, 실제로 보이는 얇은 막대는 ::-webkit-slider-runnable-track / ::-moz-range-track
// 가상 요소에 h-1로 따로 그림 — 눈에 보이는 굵기는 그대로인데 터치 가능한 세로 범위는 훨씬
// 넓어짐. 손잡이(thumb)는 트랙보다 두꺼워서(h-3) 웹킷 기준 세로 중앙 정렬용 음수 margin-top을
// 같이 줌((트랙 4px - 손잡이 12px)/2 = -4px).
const SLIDER_CLASS =
  "h-6 cursor-pointer appearance-none rounded-full bg-transparent accent-accent " +
  "[&::-webkit-slider-runnable-track]:h-1 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-white/15 " +
  "[&::-moz-range-track]:h-1 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-white/15 " +
  "[&::-webkit-slider-thumb]:mt-[-4px] [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none " +
  "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white " +
  "[&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white";

// 볼륨 아이콘 — 이모지(🔊/🔇) 대신, 앱 다른 곳(SearchBar/TrackList)과 톤을 맞춘 스트로크 SVG 아이콘
function VolumeIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M4 9v6h4l5 5V4L8 9H4z" />
      {muted ? (
        <>
          <path d="M17 9l4 6" />
          <path d="M21 9l-4 6" />
        </>
      ) : (
        <>
          <path d="M16.5 8.5a5 5 0 0 1 0 7" />
          <path d="M19 6a9 9 0 0 1 0 12" />
        </>
      )}
    </svg>
  );
}

// 확장 화면을 접을 때 쓰는 아래쪽 화살표 아이콘 (유튜브 뮤직 확장 화면의 "접기" 버튼과 같은 위치/역할)
function ChevronDownIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

// (모바일에서만 "다음 트랙" 썸네일 정사각형 모서리가 둥근 테두리 밖으로 삐져나와 보인다는
// 제보 — onError 폴백을 넣어도 그대로였던 걸 보면 이미지 로드 실패가 원인이 아니었음.
// 안드로이드 웹뷰/크롬에서 overflow-hidden + rounded 조합만으로 <img>를 클리핑하면,
// GPU 합성 레이어가 따로 뜨는 이미지의 경우 둥글게 잘린 모서리 "바깥"에 원본 정사각형
// 모서리가 살짝 겹쳐 그려지는 알려진 렌더링 버그가 있음(데스크톱 크롬/사파리는 안 겪음).
// 부모 div의 클리핑만 믿지 말고 <img> 자체에도 똑같이 rounded를 줘서 이중으로 잘라내는
// 방식으로 우회.
function TrackThumb({ src, alt, sizeClass }: { src: string | null; alt: string; sizeClass: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={`flex ${sizeClass} shrink-0 items-center justify-center overflow-hidden rounded bg-white/5`}
    >
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className="h-full w-full rounded object-cover"
          style={{ transform: "translateZ(0)" }}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="text-xs text-white/25">♪</span>
      )}
    </div>
  );
}

// 재생목록/큐/관련 항목 탭에서 공통으로 쓰는 트랙 한 줄 — 번호·썸네일·곡명·아티스트, 누르면 그 곡으로 전환.
function ExpandedTrackRow({ track, index, onClick }: { track: Track; index: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-white/5"
    >
      <span className="w-4 shrink-0 text-xs text-white/30">{index + 1}</span>
      <TrackThumb src={track.image} alt={track.name} sizeClass="h-10 w-10" />
      <div className="min-w-0">
        <p className="truncate">{track.name}</p>
        <p className="truncate text-xs text-white/50">{track.artist}</p>
      </div>
    </button>
  );
}

// "last.fm/유튜브 따까리처럼 느껴진다"는 피드백을 받고, 유튜브 iframe(로고/자막 버튼/재생바 포함)을
// 그대로 노출하는 대신 iframe은 화면 밖에 1x1로 숨기고 재생/일시정지/진행바/볼륨을 전부 우리 UI로 직접 그림.
// 이후 "다른 서비스들에 비해 재생바가 작고 정보도 부실하다"는 피드백을 받고, 스포티파이/유튜브 뮤직처럼
// 좌(앨범아트+곡정보+즐겨찾기) / 가운데(재생+진행바) / 우(볼륨) 3분할 레이아웃 + 큰 앨범아트로 확장.
export default function MiniPlayer({
  track,
  onClose,
  onActuallyPlaying,
  onEnded,
  isFavorite,
  onToggleFavorite,
  queue = [],
  onSelectQueueTrack,
  onSaveQueueToPlaylist,
  onNativeAutoAdvance,
}: MiniPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const hasFiredPlayingRef = useRef(false);
  // onEnded/onActuallyPlaying은 page.tsx에서 매 렌더 새로 만들어(인라인 화살표 함수) 넘기는데,
  // 아래 플레이어 생성 useEffect는 deps가 []라 최초 1회만 실행돼서 onStateChange 클로저가 마운트
  // 시점의 콜백만 영원히 기억함 — 곡이 바뀌어도 첫 곡 때의 콜백(=첫 곡 정보로 닫힌 클로저)이 계속
  // 불리는 버그가 될 수 있어서, 항상 최신 콜백을 가리키도록 ref로 우회함.
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const onActuallyPlayingRef = useRef(onActuallyPlaying);
  onActuallyPlayingRef.current = onActuallyPlaying;
  const onNativeAutoAdvanceRef = useRef(onNativeAutoAdvance);
  onNativeAutoAdvanceRef.current = onNativeAutoAdvance;
  // (§73 후속) 헤드리스 웹뷰가 스스로 다음 곡으로 넘어간 직후, 그 결과로 page.tsx가
  // nowPlaying을 바꿔서 내려주는 track.videoId가 "네이티브가 이미 재생 중인 그 곡"과 같으면
  // 아래 트랙 전환 effect가 loadVideoById를 또 부르지 않도록 막는 가드.
  const lastAutoAdvancedVideoIdRef = useRef<string | null>(null);
  // (§73 후속) 지금 네이티브에 넘겨둔 "다음 곡 미리보기" 목록의 식별 키 — 같은 목록으로
  // 중복 네트워크 호출/중복 setQueue 호출을 막기 위함.
  const nativeLookaheadRef = useRef<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(70);
  const [isMuted, setIsMuted] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  // 유튜브 뮤직의 확장 재생 화면(앨범아트 크게 + 다음 트랙/관련 항목/가사 탭)을 참고해서 추가.
  // 미니 플레이어 하단 바의 앨범아트나 곡 정보를 누르면 이 전체화면 오버레이가 열림.
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<ExpandedTab>("queue");

  // "가사" 탭 — 원래는 Genius/YouTube 둘 다 가사 원문을 못 줘서 보류했다가, API 키 없이 무료로
  // 크라우드소싱 가사를 주는 LRCLIB을 찾아서 붙임. syncedLyrics(LRC 타임스탬프)가 있으면
  // 파싱해서 currentTime에 맞춰 지금 부르는 줄을 하이라이트하고, 없으면 plainLyrics를 그냥 보여줌.
  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);
  const lastLyricsKeyRef = useRef<string | null>(null);
  // "가사 올려주세요" 버튼용 — LRCLIB에 없는 곡을 자동으로 채울 방법은 없어서, 대신 요청만
  // 남겨두고 운영자가 직접 확인해서 나중에 수동으로 등록하는 최소한의 파이프라인.
  const [lyricsRequestState, setLyricsRequestState] = useState<"idle" | "sending" | "sent">("idle");

  useEffect(() => {
    if (!isExpanded || activeTab !== "lyrics") return;
    const key = `${track.artist}::${track.name}`;
    if (lastLyricsKeyRef.current === key) return;
    lastLyricsKeyRef.current = key;
    setIsLoadingLyrics(true);
    setLyrics(null);
    setLyricsRequestState("idle");
    getLyrics(track.artist, track.name)
      .then(setLyrics)
      .catch(() => setLyrics({ found: false, syncedLyrics: null, plainLyrics: null }))
      .finally(() => setIsLoadingLyrics(false));
  }, [isExpanded, activeTab, track.artist, track.name]);

  function handleRequestLyrics() {
    setLyricsRequestState("sending");
    requestLyrics(track.artist, track.name)
      .then(() => setLyricsRequestState("sent"))
      .catch(() => setLyricsRequestState("idle"));
  }

  const syncedLines = lyrics?.syncedLyrics ? parseSyncedLyrics(lyrics.syncedLyrics) : [];
  // 지금 재생 위치보다 시작 시각이 앞선 마지막 줄 = 지금 부르고 있는 줄
  const activeLyricIndex =
    syncedLines.length > 0
      ? syncedLines.reduce((acc, line, idx) => (line.time <= currentTime ? idx : acc), -1)
      : -1;
  const activeLyricLineRef = useRef<HTMLParagraphElement>(null);
  // 가사를 읽으려고 사용자가 직접 스크롤했을 땐, 다음 줄로 넘어갈 때마다 자동으로 다시
  // 끌어내려서 "내려가기만 하고 못 올라간다"는 문제가 있었음 — 휠/터치로 스크롤을 건드리면
  // 일정 시간(4초) 동안은 자동 스크롤을 멈추고, 그 뒤엔 다시 현재 줄을 따라가게 함.
  const isUserScrollingLyricsRef = useRef(false);
  const userScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleLyricsManualScroll() {
    isUserScrollingLyricsRef.current = true;
    if (userScrollTimeoutRef.current) clearTimeout(userScrollTimeoutRef.current);
    userScrollTimeoutRef.current = setTimeout(() => {
      isUserScrollingLyricsRef.current = false;
    }, 4000);
  }

  useEffect(() => {
    if (isUserScrollingLyricsRef.current) return;
    activeLyricLineRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeLyricIndex]);

  // 플레이어 인스턴스는 최초 1회만 생성 — 곡이 바뀔 때마다 새로 만들면 로딩이 끊기고 깜빡여서,
  // 아래 별도 effect에서 같은 인스턴스에 loadVideoById로 영상만 교체함.
  useEffect(() => {
    let cancelled = false;

    function handleReady(e: any) {
      e.target.setVolume(volume);
      e.target.playVideo();
      setDuration(e.target.getDuration());
    }

    function handleStateChange(e: any) {
      setIsPlaying(e.data === YT_STATE.PLAYING);
      if (e.data === YT_STATE.PLAYING) {
        setDuration(e.target.getDuration());
        if (!hasFiredPlayingRef.current) {
          hasFiredPlayingRef.current = true;
          onActuallyPlayingRef.current?.();
        }
      }
      if (e.data === YT_STATE.ENDED) {
        onEndedRef.current?.();
      }
    }

    if (isNativeAndroid()) {
      // (§73) 안드로이드 앱에서는 이 화면(액티비티) 웹뷰가 아니라, 포그라운드 서비스가
      // 소유한 별도의 "안 보이는" 웹뷰(PlaybackService.java)에서 실제 유튜브 iframe이
      // 돌아감 — 홈 버튼을 눌러도 오디오가 안 죽는 이유. 여기서 만드는 건 그 서비스를
      // 원격 조종하는 프록시일 뿐, containerRef(화면의 1x1 div)는 네이티브 경로에서는
      // 안 쓰임. 자세한 배경은 LEARNING_NOTES.md §72/§73 참고.
      playerRef.current = createNativePlayer(track.videoId, track.name, track.artist, {
        onReady: handleReady,
        onStateChange: handleStateChange,
        onAutoAdvance: (data) => {
          lastAutoAdvancedVideoIdRef.current = data.videoId;
          hasFiredPlayingRef.current = false;
          setCurrentTime(0);
          setIsPlaying(false);
          onNativeAutoAdvanceRef.current?.(data);
        },
      });
    } else {
      loadYoutubeApi().then(() => {
        if (cancelled || !containerRef.current) return;
        const YT = (window as any).YT;
        playerRef.current = new YT.Player(containerRef.current, {
          height: "1",
          width: "1",
          videoId: track.videoId,
          playerVars: { autoplay: 1, controls: 0, modestbranding: 1, rel: 0 },
          events: { onReady: handleReady, onStateChange: handleStateChange },
        });
      });
    }

    return () => {
      cancelled = true;
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 트랙 카드를 새로 누르면(videoId가 바뀌면) 플레이어를 새로 만들지 않고 영상만 교체
  useEffect(() => {
    if (!playerRef.current?.loadVideoById) return;
    // (§73 후속) 방금 헤드리스 웹뷰가 스스로 이 videoId로 넘어간 직후라면(화면 꺼짐 상태
    // 자동전환), 여기서 또 loadVideoById를 부르면 이미 재생 중인 영상을 처음부터 다시
    // 로드해버려서 소리가 끊기고 되감김. 그 경우는 UI 상태만 맞추고 native 호출은 건너뜀.
    if (isNativeAndroid() && lastAutoAdvancedVideoIdRef.current === track.videoId) {
      lastAutoAdvancedVideoIdRef.current = null;
      hasFiredPlayingRef.current = false;
      setCurrentTime(0);
      setIsPlaying(false);
      return;
    }
    hasFiredPlayingRef.current = false;
    setCurrentTime(0);
    setIsPlaying(false);
    playerRef.current.loadVideoById(track.videoId, track.name, track.artist);
  }, [track.videoId]);

  // (§73 후속) 다음 트랙 큐의 앞쪽 몇 곡의 videoId를 미리 resolve해서 네이티브 헤드리스
  // 웹뷰에 통째로 넘겨둠 — 화면이 꺼져서 이 화면의 JS가 못 도는 동안에도(자면서/헬스장/
  // 지하철처럼 한동안 방치) 곡이 끝날 때마다 헤드리스 웹뷰가 스스로 이어서 여러 곡을 틀 수
  // 있게 하기 위함. 1곡만 미리 넘겨두면 그다음 곡부터는 화면 웹뷰가 그 사이에 깨어나야만
  // 이어지는 문제가 있어서(사용자 피드백으로 확대), 큐가 이미 최대 40곡까지 갖고 있는 걸
  // 활용해 앞쪽 NATIVE_LOOKAHEAD곡을 한 번에 resolve함. 자세한 배경은 LEARNING_NOTES.md
  // §73 참고.
  useEffect(() => {
    if (!isNativeAndroid()) return;
    const NATIVE_LOOKAHEAD = 5;
    const candidates = queue.slice(0, NATIVE_LOOKAHEAD);
    if (candidates.length === 0) {
      nativeLookaheadRef.current = null;
      playerRef.current?.setQueue?.([]);
      return;
    }
    const key = candidates
      .map((t) => `${t.artist.toLowerCase().trim()}::${t.name.toLowerCase().trim()}`)
      .join("|");
    if (nativeLookaheadRef.current === key) return;
    let cancelled = false;
    (async () => {
      try {
        const resolved = await Promise.all(
          candidates.map(async (t) => {
            try {
              const videoId = t.videoId ?? (await searchYoutubeVideo(t.artist, t.name)).videoId;
              return videoId ? { videoId, title: t.name, artist: t.artist } : null;
            } catch {
              return null;
            }
          })
        );
        if (cancelled) return;
        // 개별 곡 resolve가 실패해도(예: 유튜브에 없음) 나머지 성공한 곡들의 순서는 그대로
        // 유지 — 네이티브 쪽에서 그 실패한 자리만 자연스럽게 건너뛰는 것과 동치.
        const tracks = resolved.filter(
          (r): r is { videoId: string; title: string; artist: string } => r !== null
        );
        nativeLookaheadRef.current = key;
        playerRef.current?.setQueue?.(tracks);
      } catch {
        // 프리페치 실패는 조용히 무시 — 화면 켜져 있을 때의 기존 자동전환 경로엔 영향 없음.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queue]);

  // 진행바용 재생 위치 폴링 (유튜브 API는 재생 위치 변경 이벤트가 따로 없어서 주기적으로 조회해야 함)
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      const t = playerRef.current?.getCurrentTime?.();
      if (typeof t === "number") setCurrentTime(t);
    }, 500);
    return () => clearInterval(id);
  }, [isPlaying]);

  function togglePlay() {
    if (!playerRef.current) return;
    if (isPlaying) playerRef.current.pauseVideo?.();
    else playerRef.current.playVideo?.();
  }

  // Media Session API — 잠금화면/알림에 곡 정보와 재생/일시정지 컨트롤을 노출함. 그 자체로 배경
  // 재생을 보장하진 않지만(§63/§64 논의 참고 — 그건 유튜브 iframe이 크로스 오리진이라 iOS/Android
  // 둘 다 백그라운드에서 미디어를 정지시키는 별개 문제), 나중에 Capacitor 네이티브 래퍼로 감쌀 때
  // OS가 "이건 진짜 미디어 재생 중"이라고 인식하게 하는 전제 조건이라 미리 붙여둠. 지금 당장도
  // 안드로이드 크롬 등에서 알림/잠금화면에 곡 정보가 뜨는 부수 효과가 있음.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.name,
      artist: track.artist,
      artwork: track.image ? [{ src: track.image, sizes: "512x512", type: "image/jpeg" }] : [],
    });
  }, [track.name, track.artist, track.image]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    navigator.mediaSession.setActionHandler("play", () => playerRef.current?.playVideo?.());
    navigator.mediaSession.setActionHandler("pause", () => playerRef.current?.pauseVideo?.());
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime == null) return;
      playerRef.current?.seekTo?.(details.seekTime, true);
      setCurrentTime(details.seekTime);
    });
    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("seekto", null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (§72→§73) 예전엔 여기서 cordova-plugin-background-mode를 켜고 꺼서 포그라운드
  // 서비스를 붙였었는데, 그렇게 해도 화면(액티비티) 웹뷰 자체가 홈 버튼 누르면 렌더링
  // 서피스가 정리되면서 오디오까지 끊기는 걸 실기로 확인함(§72 라이브 디버깅 기록). 지금은
  // PlaybackService.java가 재생 상태에 따라 자기 알림을 직접 켜고 끄므로(§73), 여기서
  // 따로 배경모드를 제어할 필요가 없어져서 이 이펙트 자체를 제거함.

  // (진행바 드래그 중 계속 0초로 돌아가는 문제 수정) <input type="range">는 드래그하는 동안
  // 픽셀 단위로 onChange가 수십~수백 번 연달아 발생함. 예전엔 그때마다 매번 실제
  // seekTo를 호출했는데, 특히 안드로이드 네이티브 경로(헤드리스 웹뷰의 유튜브 iframe)에서
  // 너무 잦은 연속 seek 요청이 서로를 끊고 들어가면서 버퍼링이 안정될 틈이 없어 재생
  // 위치가 순간적으로 0으로 보고되는 현상이 있었음. 이제 onChange는 화면에 보이는 슬라이더
  // 위치만 갱신하고, 실제 seekTo 호출은 손가락/마우스를 뗀 순간(onMouseUp/onTouchEnd) 딱
  // 한 번만 나가도록 분리함.
  function handleSeekPreview(e: React.ChangeEvent<HTMLInputElement>) {
    setCurrentTime(Number(e.target.value));
  }

  function handleSeekCommit(e: React.SyntheticEvent<HTMLInputElement>) {
    const value = Number(e.currentTarget.value);
    setCurrentTime(value);
    playerRef.current?.seekTo?.(value, true);
  }

  // 가사 탭에서 특정 줄을 누르면 그 가사가 나오는 시점으로 바로 이동 — 진행바 탐색(handleSeek)과
  // 같은 seekTo 호출을 재사용. 사용자가 직접 누른 이동이니 자동 스크롤 억제 타이머도 리셋해서,
  // 클릭 직후 활성 줄이 화면 밖에 있어도(예: 곡 뒷부분으로 점프) 자동 스크롤이 정상 작동하게 함.
  function handleSeekToLyric(time: number) {
    setCurrentTime(time);
    playerRef.current?.seekTo?.(time, true);
    isUserScrollingLyricsRef.current = false;
    if (userScrollTimeoutRef.current) clearTimeout(userScrollTimeoutRef.current);
  }

  function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = Number(e.target.value);
    setVolume(value);
    playerRef.current?.setVolume?.(value);
    if (value > 0 && isMuted) {
      setIsMuted(false);
      playerRef.current?.unMute?.();
    }
  }

  function toggleMute() {
    if (!playerRef.current) return;
    if (isMuted) {
      playerRef.current.unMute?.();
      setIsMuted(false);
    } else {
      playerRef.current.mute?.();
      setIsMuted(true);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-black/95 backdrop-blur">
      {/* 실제 유튜브 iframe — 화면엔 안 보이게 숨겨두고 오디오 소스로만 씀 */}
      <div
        ref={containerRef}
        className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0"
      />

      {/* 모바일 전용 축약 바 — 데스크톱 3분할(좌: 정보 / 가운데: 재생+진행바 / 우: 큐+볼륨+닫기)을
          그대로 세로로 쌓으면 바 높이가 3배로 늘어나서 화면을 너무 많이 잡아먹고, 실기기(카카오톡
          인앱 브라우저 등)에서 아래쪽 줄이 화면 밖으로 밀려 잘려 보이는 문제가 있었음("재생바 규격이
          안 맞는다"는 피드백). 모바일에선 음악 앱들처럼 얇은 진행바 + 한 줄(썸네일/곡정보/재생/닫기)만
          보여주고, 큐/볼륨은 확장 화면(터치하면 열림, "다음 트랙" 탭)에서 쓰도록 뺌. */}
      <div className="sm:hidden">
        <div className="h-1 w-full bg-white/10">
          <div
            className="h-full bg-accent"
            style={{ width: `${duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0}%` }}
          />
        </div>
        <div className="flex items-center gap-3 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            aria-label="확장 재생 화면 열기"
            className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white/5"
          >
            {track.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={track.image} alt={track.name} className="h-full w-full object-cover" />
            ) : (
              <span className="text-lg text-white/25">♪</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="min-w-0 flex-1 text-left"
          >
            <p className="truncate text-sm font-medium">{track.name}</p>
            <p className="truncate text-xs text-white/50">{track.artist}</p>
          </button>
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? "일시정지" : "재생"}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-sm text-black"
          >
            {isPlaying ? "❚❚" : "▶"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="플레이어 닫기"
            className="shrink-0 rounded-full p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="mx-auto hidden max-w-6xl grid-cols-[1fr_2fr_1fr] items-center gap-4 px-6 py-3 sm:grid">
        {/* 왼쪽: 앨범아트(크게) + 곡 정보 + 즐겨찾기 — 앨범아트/곡 정보를 누르면 확장 재생 화면이 열림
            (유튜브 뮤직에서 하단 재생바를 누르면 전체화면으로 전환되는 것과 같은 진입 동선) */}
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            aria-label="확장 재생 화면 열기"
            className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white/5"
          >
            {track.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={track.image} alt={track.name} className="h-full w-full object-cover" />
            ) : (
              <span className="text-2xl text-white/25">♪</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="min-w-0 text-left"
          >
            <p className="truncate text-sm font-medium">{track.name}</p>
            <p className="truncate text-xs text-white/50">{track.artist}</p>
          </button>
          {onToggleFavorite && (
            <button
              type="button"
              onClick={onToggleFavorite}
              aria-label={isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
              className="ml-1 shrink-0 rounded-full p-1.5 text-lg text-yellow-400 hover:bg-white/10"
            >
              {isFavorite ? "★" : "☆"}
            </button>
          )}
        </div>

        {/* 가운데: 재생/일시정지 + 진행바 */}
        <div className="flex flex-col items-center gap-1.5">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? "일시정지" : "재생"}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-sm text-black"
          >
            {isPlaying ? "❚❚" : "▶"}
          </button>
          <div className="flex w-full items-center gap-2 text-[10px] text-white/40">
            <span className="w-8 shrink-0 text-right">{formatTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              value={Math.min(currentTime, duration || 0)}
              onChange={handleSeekPreview}
              onMouseUp={handleSeekCommit}
              onTouchEnd={handleSeekCommit}
              className={`${SLIDER_CLASS} flex-1`}
            />
            <span className="w-8 shrink-0">{formatTime(duration)}</span>
          </div>
        </div>

        {/* 오른쪽: 다음 트랙 큐 + 볼륨 + 닫기 */}
        <div className="flex items-center justify-end gap-2">
          {onSelectQueueTrack && (
            <button
              type="button"
              onClick={() => setIsQueueOpen((v) => !v)}
              aria-label="다음 트랙"
              title="다음 트랙"
              className={`shrink-0 rounded-full p-1.5 hover:bg-white/10 hover:text-white ${
                isQueueOpen ? "text-white" : "text-white/50"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M3 6h13" />
                <path d="M3 12h13" />
                <path d="M3 18h9" />
                <path d="M17 8v8l6-4-6-4z" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={toggleMute}
            aria-label={isMuted || volume === 0 ? "음소거 해제" : "음소거"}
            className="shrink-0 rounded-full p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
          >
            <VolumeIcon muted={isMuted || volume === 0} />
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={isMuted ? 0 : volume}
            onChange={handleVolumeChange}
            className={`hidden w-20 sm:block ${SLIDER_CLASS}`}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="플레이어 닫기"
            className="shrink-0 rounded-full p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>
      </div>

      {/* "다음 트랙" 큐 패널 — 유튜브 뮤직처럼 곡과 비슷한 곡을 미리 보여주고, 눌러서 바로
          재생으로 넘어갈 수 있게 함. 재생바 위로 뜨는 패널로 만든 이유는 MiniPlayer가 이미
          "지금 어떤 곡이 재생 중인가" 하나만 아는 전역 오버레이라 같은 자리에 붙이는 게
          자연스럽고, 사이드바 공간을 새로 안 써도 됨. */}
      {isQueueOpen && onSelectQueueTrack && (
        <div className="absolute inset-x-0 bottom-full mx-auto max-w-6xl px-6">
          <div className="mb-2 max-h-72 overflow-y-auto rounded-lg border border-white/10 bg-neutral-900/95 backdrop-blur">
            <p className="border-b border-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white/40">
              다음 트랙
            </p>
            {queue.length === 0 ? (
              <p className="px-3 py-3 text-xs text-white/40">비슷한 곡을 찾는 중이거나 없어요.</p>
            ) : (
              <div className="flex flex-col">
                {queue.map((t, idx) => (
                  <button
                    key={`${t.artist}-${t.name}-${idx}`}
                    type="button"
                    onClick={() => {
                      onSelectQueueTrack(t);
                      setIsQueueOpen(false);
                    }}
                    className="flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/5"
                  >
                    <span className="w-4 shrink-0 text-xs text-white/30">{idx + 1}</span>
                    <TrackThumb src={t.image} alt={t.name} sizeClass="h-8 w-8" />
                    <div className="min-w-0">
                      <p className="truncate">{t.name}</p>
                      <p className="truncate text-xs text-white/50">{t.artist}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 확장 재생 화면 — 유튜브 뮤직 확장 플레이어(큰 앨범아트 + 오른쪽 다음 트랙/가사/관련 항목 탭)를
          참고해서 추가. 페이지 이동 없이 같은 화면 위에 전체화면 오버레이로 뜨는 방식을 택함 —
          미니 플레이어가 이미 갖고 있는 재생 상태(currentTime/isPlaying/volume 등)를 그대로
          재사용할 수 있고, 뒤로가기/새로고침 시 재생이 끊기는 문제도 없어서 별도 라우트보다 단순함. */}
      {isExpanded &&
        typeof document !== "undefined" &&
        createPortal(
        <div className="fixed inset-0 z-40 flex h-[100dvh] flex-col overflow-y-auto bg-neutral-950 lg:overflow-hidden">
          {/* 모바일 iOS Safari에서 앨범아트/헤더 버튼이 화면 위쪽으로 잘려 안 보이던 문제 — 두 가지가
              겹친 것으로 보임: (1) 정적 100vh 기준이라 주소창이 접혔다 펴졌다 하는 모바일 브라우저에서
              실제 보이는 영역과 어긋날 수 있어 h-[100dvh](동적 뷰포트 높이)로 교체, (2) 데스크톱에서만
              의미 있던 grid-cols-1(모바일)일 때 왼쪽(앨범아트)/오른쪽(탭+목록) 블록이 각각 내부
              overflow-hidden/overflow-y-auto로 따로 잘려서, 화면 하나에 다 안 들어가면 남는 부분이
              스크롤 없이 그냥 안 보이게 잘렸던 것 — 데스크톱(lg)에서만 내부 스크롤을 쓰고, 모바일에선
              이 바깥 오버레이 전체가 통째로 스크롤되게 바꿈. */}
          <div className="flex items-center justify-between px-6 py-4">
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              aria-label="확장 화면 접기"
              className="rounded-full p-2 text-white/50 hover:bg-white/10 hover:text-white"
            >
              <ChevronDownIcon />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="플레이어 닫기"
              className="rounded-full p-2 text-white/50 hover:bg-white/10 hover:text-white"
            >
              ✕
            </button>
          </div>

          {/* (다음 트랙 패널이 모바일에서 테두리 밖으로 넘치던 버그의 진짜 원인) 이 그리드
              자체가 min-h-0 + flex-1로 위 오버레이(h-[100dvh])의 남은 높이만큼만 차지하도록
              눌려 있었음 — grid-cols-1(모바일)에서도 grid는 기본 align-content:stretch라
              한 칸짜리 auto 행이 이 눌린 높이에 맞춰 강제로 늘어나고(정확히는 줄어들고),
              그 안의 오른쪽 패널(border rounded-xl)도 같이 눌려서 실제 목록 내용보다 짧게
              그려짐 — 목록 자체는 안 잘리고(overflow-hidden 아님) 그 눌린 테두리 밖으로
              그냥 삐져나와 보이는 것. sandbox 브라우저로 375x812 뷰포트에 똑같은 구조를
              직접 재현해서 확인함. 데스크톱(lg)에서만 이 그리드가 높이를 눌러서 두 칼럼을
              stretch로 맞추는 의미가 있으므로, min-h-0/flex-1을 lg:에서만 걸리게 바꿈. */}
          <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-8 px-6 pb-10 lg:min-h-0 lg:flex-1 lg:grid-cols-2">
            {/* 왼쪽: 큰 앨범아트 + 곡 정보 + 재생 컨트롤 — 오른쪽 가사/큐 목록이 길어져도 그리드가
                양쪽을 같은 높이로 맞춰주고(stretch) 이 칸은 그 안에서 세로 중앙 정렬만 하기 때문에,
                오른쪽이 아무리 길어도 앨범아트가 화면 밖으로 밀려나지 않음. */}
            <div className="flex min-h-0 flex-col items-center justify-center gap-6 py-4 lg:overflow-y-auto">
              <div className="flex h-72 w-72 items-center justify-center overflow-hidden rounded-xl bg-white/5 shadow-2xl sm:h-80 sm:w-80">
                {track.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={track.image} alt={track.name} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-6xl text-white/25">♪</span>
                )}
              </div>
              <div className="text-center">
                <p className="text-xl font-semibold">{track.name}</p>
                <p className="mt-1 text-white/50">{track.artist}</p>
              </div>
              <div className="flex items-center gap-5">
                {onToggleFavorite && (
                  <button
                    type="button"
                    onClick={onToggleFavorite}
                    aria-label={isFavorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
                    className="rounded-full p-2 text-2xl text-yellow-400 hover:bg-white/10"
                  >
                    {isFavorite ? "★" : "☆"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={isPlaying ? "일시정지" : "재생"}
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white text-lg text-black"
                >
                  {isPlaying ? "❚❚" : "▶"}
                </button>
              </div>
              <div className="flex w-full max-w-sm items-center gap-2 text-xs text-white/40">
                <span className="w-8 shrink-0 text-right">{formatTime(currentTime)}</span>
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  value={Math.min(currentTime, duration || 0)}
                  onChange={handleSeekPreview}
                  onMouseUp={handleSeekCommit}
                  onTouchEnd={handleSeekCommit}
                  className={`${SLIDER_CLASS} flex-1`}
                />
                <span className="w-8 shrink-0">{formatTime(duration)}</span>
              </div>
            </div>

            {/* 오른쪽: 다음 트랙 / 관련 항목 / 가사 탭 */}
            <div className="flex min-h-[24rem] flex-col rounded-xl border border-white/10 bg-white/[0.02] lg:min-h-0 lg:overflow-hidden">
              <div className="flex border-b border-white/10 text-sm">
                {(
                  [
                    { key: "queue", label: "다음 트랙" },
                    { key: "lyrics", label: "가사" },
                  ] as { key: ExpandedTab; label: string }[]
                ).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex-1 border-b-2 px-3 py-3 font-medium ${
                      activeTab === tab.key
                        ? "border-white text-white"
                        : "border-transparent text-white/40 hover:text-white/70"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div
                className="p-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
                onWheel={activeTab === "lyrics" ? handleLyricsManualScroll : undefined}
                onTouchMove={activeTab === "lyrics" ? handleLyricsManualScroll : undefined}
              >
                {activeTab === "queue" &&
                  (queue.length === 0 ? (
                    <p className="p-4 text-sm text-white/40">비슷한 곡을 찾는 중이거나 없어요.</p>
                  ) : (
                    <>
                      {/* 유튜브 뮤직의 "다음 트랙 전체를 재생목록에 저장" 버튼을 참고 — 곡을
                          하나씩 담을 필요 없이 지금 큐에 뜬 목록 전체를 한 번에 옮길 수 있음.
                          "관련 항목" 탭을 없앤 대신 생긴 자리라 탭 콘텐츠 맨 위에 둠. */}
                      {onSaveQueueToPlaylist && (
                        <div className="flex justify-end px-2 pb-1">
                          <button
                            type="button"
                            onClick={() => onSaveQueueToPlaylist(queue)}
                            className="flex items-center gap-1 rounded-full border border-white/15 px-3 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white"
                          >
                            <span className="text-sm leading-none">＋</span>
                            재생목록에 저장
                          </button>
                        </div>
                      )}
                      {queue.map((t, idx) => (
                        <ExpandedTrackRow
                          key={`${t.artist}-${t.name}-${idx}`}
                          track={t}
                          index={idx}
                          onClick={() => onSelectQueueTrack?.(t)}
                        />
                      ))}
                    </>
                  ))}

                {activeTab === "lyrics" &&
                  (isLoadingLyrics ? (
                    <p className="p-4 text-sm text-white/40">가사를 불러오는 중...</p>
                  ) : lyrics?.takenDown ? (
                    // 저작권자 삭제 요청으로 내려간 곡. "아직 못 찾음"과 구분해서 안내하고,
                    // 다시 요청해봐야 어차피 영구 차단(blocklist)에 걸려 소용없으므로 요청 버튼은 안 보여줌.
                    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
                      <p className="text-sm text-white/50">저작권자 요청으로 이 곡의 가사가 내려갔어요.</p>
                    </div>
                  ) : !lyrics?.found ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
                      <p className="text-sm text-white/50">이 곡의 가사를 찾지 못했어요.</p>
                      <p className="text-xs text-white/30">
                        크라우드소싱 가사 데이터베이스(LRCLIB)에 아직 등록되지 않은 곡일 수 있어요.
                      </p>
                      <button
                        type="button"
                        onClick={handleRequestLyrics}
                        disabled={lyricsRequestState !== "idle"}
                        className="mt-2 rounded-full border border-white/15 px-4 py-1.5 text-xs text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-50"
                      >
                        {lyricsRequestState === "sent"
                          ? "요청했어요 ✓"
                          : lyricsRequestState === "sending"
                          ? "요청 중..."
                          : "가사 올려주세요"}
                      </button>
                    </div>
                  ) : syncedLines.length > 0 ? (
                    <div className="flex flex-col gap-3 px-4 py-6">
                      {syncedLines.map((line, idx) => (
                        <p
                          key={idx}
                          ref={idx === activeLyricIndex ? activeLyricLineRef : undefined}
                          onClick={() => handleSeekToLyric(line.time)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") handleSeekToLyric(line.time);
                          }}
                          className={`cursor-pointer text-base leading-relaxed transition-colors hover:text-white ${
                            idx === activeLyricIndex ? "font-semibold text-white" : "text-white/35"
                          }`}
                        >
                          {line.text}
                        </p>
                      ))}
                      <p className="mt-2 text-[11px] text-white/25">
                        가사 출처: 커뮤니티 가사 데이터베이스 · 저작권자 요청 시 즉시 삭제됩니다.
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 px-4 py-6">
                      <p className="whitespace-pre-line text-sm leading-relaxed text-white/70">
                        {lyrics.plainLyrics}
                      </p>
                      <p className="text-[11px] text-white/25">
                        가사 출처: 커뮤니티 가사 데이터베이스 · 저작권자 요청 시 즉시 삭제됩니다.
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
