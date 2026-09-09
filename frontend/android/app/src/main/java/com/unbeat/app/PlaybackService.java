package com.unbeat.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;

import org.json.JSONObject;

/**
 * (§73) 안드로이드 백그라운드 재생 재설계.
 *
 * §72에서 실기로 확인한 근본 원인: 화면에 보이는 MainActivity의 웹뷰는, 액티비티가
 * onStop()으로 넘어가는 순간(홈 버튼) 렌더링 서피스가 시스템에 의해 정리되면서 거기 물려있던
 * 오디오 스트림까지 같이 끊김(Logcat으로 "App stopped" 직후 70ms 만에 AAudioStream_requestStop
 * 확인함). 포그라운드 서비스/알림/권한을 다 고쳐도 이 부분은 안 고쳐짐 — 액티비티 생명주기에
 * 물린 웹뷰 자체의 한계라서.
 *
 * 그래서 실제 유튜브 iframe 재생은 액티비티가 아니라 이 "포그라운드 서비스"가 소유하는 별도의
 * 안 보이는 WebView(headless)에서 하도록 옮김. 서비스는 액티비티가 죽거나 백그라운드로 가도
 * (포그라운드 서비스로 떠 있는 한) 안드로이드가 안 죽이므로, 여기 물린 웹뷰/오디오도 계속 살아있음.
 * MainActivity 쪽 웹뷰(화면에 보이는 Next.js 앱)는 이제 오디오 소스가 아니라 "재생 상태를
 * 보여주고 컨트롤만 보내는" 역할만 함 — 실제 소리는 이 서비스 안에서 남.
 */
public class PlaybackService extends Service {

    private static final String TAG = "PlaybackService";
    private static final String CHANNEL_ID = "unbeat-playback";
    private static final int NOTIFICATION_ID = 5721;
    // (§73 추가) 알림에 재생/일시정지 토글 버튼을 넣기 위한 액션 — 알림의 버튼을 누르면
    // 안드로이드가 이 액션이 담긴 Intent로 이 서비스를 다시 시작(onStartCommand)해줌.
    private static final String ACTION_TOGGLE_PLAY_PAUSE = "com.unbeat.app.ACTION_TOGGLE_PLAY_PAUSE";

    public interface PlaybackListener {
        void onEvent(String type, JSONObject data);
    }

    private final IBinder binder = new LocalBinder();
    // (§73) Capacitor는 플러그인 메서드(@PluginMethod)를 메인(UI) 스레드가 아니라 자기
    // 전용 백그라운드 스레드("CapacitorPlugins" HandlerThread)에서 실행함 — 그런데
    // WebView.evaluateJavascript()나 startForeground()/stopForeground() 같은 건 UI
    // 스레드에서 불러야 안전해서, 이 서비스로 들어오는 모든 컨트롤 호출을 메인 스레드로
    // 다시 포스팅해서 실행함. (안 하면 CalledFromWrongThreadException 위험)
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private WebView webView;
    private PlaybackListener listener;
    private String currentTitle = "Unbeat";
    private String currentArtist = "";
    // (§73 타이밍 버그 수정) WebViewAssetLoader로 바꾼 뒤 로그에서 "Uncaught TypeError:
    // window.nativeLoadAndPlay is not a function" 확인함 — player.html이 아직 로딩(파싱)
    // 안 끝난 상태에서 자바 쪽이 evaluateJavascript로 그 안의 함수를 바로 부르려 해서 생긴
    // 문제. 앱 켜자마자 바로 곡을 누르면 이 로딩이 끝나기 전에 명령이 도착해서 매번 실패함.
    // onPageFinished가 될 때까지 실행할 스크립트를 큐에 모아뒀다가, 로드가 끝나면 한번에 흘려보냄.
    private boolean pageLoaded = false;
    private final java.util.List<String> pendingScripts = new java.util.ArrayList<>();
    // (§73 추가) 알림의 재생/일시정지 버튼 아이콘·라벨을 결정하는 현재 재생 상태.
    // player.html의 stateChange 이벤트(state==1이면 재생 중)로만 갱신됨.
    private boolean isPlaying = false;

    public class LocalBinder extends Binder {
        PlaybackService getService() {
            return PlaybackService.this;
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }

    public void setListener(PlaybackListener l) {
        this.listener = l;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        setupWebView();
    }

    private void setupWebView() {
        // 이 웹뷰는 화면에 절대 안 붙임(addContentView 안 함) — Context만 있으면 WebView
        // 인스턴스 생성 자체는 가능하고, evaluateJavascript로 계속 상호작용할 수 있음.
        webView = new WebView(getApplicationContext());
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        webView.addJavascriptInterface(new JsBridge(), "AndroidBridge");

        // (§73 라이브 디버깅) player.html을 file:///android_asset/...로 바로 로드하면
        // 유튜브 IFrame API의 onReady가 영원히 안 불림 — 유튜브 위젯이 file://(오리진이
        // 사실상 null 취급)에서는 정상 초기화를 안 해주는 것으로 보임.
        //
        // (§73 추가 디버깅) WebViewAssetLoader로 https://appassets.androidx.local/ 을 통해
        // 서빙해보려 했으나, 이 서비스의 헤드리스 웹뷰에서는 shouldInterceptRequest 가로채기가
        // 실제로 안 먹혀서 진짜 네트워크로 (존재하지 않는) 그 도메인에 접속을 시도하다가
        // net::ERR_CONNECTION_TIMED_OUT 으로 실패하는 걸 실기로 확인함(Logcat 에러 코드 -8).
        // 그래서 네트워크 요청 자체가 필요 없는 방식으로 변경: player.html 내용을 자바에서
        // 직접 읽어서 loadDataWithBaseURL로 즉시 주입함. baseUrl을 https://appassets.androidx.local/
        // 로 지정해서 origin은 여전히 정상적인 https로 보이게 하면서, 실제 로딩은 동기적으로
        // 끝나서 타임아웃/가로채기 문제 자체가 없음.
        String playerHtml = readAssetAsString("player.html");
        webView.setWebViewClient(new android.webkit.WebViewClient() {
            // (§73 타이밍 버그 수정) player.html의 <script> 블록이 실제로 다 실행된 뒤에만
            // window.native* 함수들이 존재함. onPageFinished 전에 evaluateJavascript를 부르면
            // "is not a function" 에러가 나서 아무 것도 재생 안 되는 문제가 있었음 — 여기서
            // 로드 완료를 감지해서 그동안 쌓인 명령을 순서대로 실행함.
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                Log.d(TAG, "player.html onPageFinished: " + url);
                pageLoaded = true;
                for (String script : pendingScripts) {
                    webView.evaluateJavascript(script, null);
                }
                pendingScripts.clear();
            }

            // (§73 진단용) onPageFinished가 성공한 것처럼 찍혀도 실제로는
            // chrome-error://chromewebdata 에러 페이지가 대신 뜬 걸 실기로 확인함
            // (Logcat에 "source: chrome-error://chromewebdata/" 확인됨) — onPageFinished는
            // 실패해도 원래 요청 URL을 그대로 보고하는 WebView의 특성 때문에 성공처럼
            // 보였던 것. 정확한 에러 코드/설명을 잡기 위해 추가.
            @Override
            public void onReceivedError(WebView view, android.webkit.WebResourceRequest request,
                    android.webkit.WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    Log.e(TAG, "onReceivedError url=" + request.getUrl()
                            + " isMainFrame=" + request.isForMainFrame()
                            + " code=" + error.getErrorCode()
                            + " desc=" + error.getDescription());
                }
            }
        });
        webView.loadDataWithBaseURL(
                "https://appassets.androidx.local/",
                playerHtml,
                "text/html",
                "UTF-8",
                null);
    }

    /** assets/ 안의 텍스트 파일을 문자열로 읽음 (player.html을 loadDataWithBaseURL로 직접 주입하기 위함). */
    private String readAssetAsString(String fileName) {
        StringBuilder sb = new StringBuilder();
        try (java.io.BufferedReader reader = new java.io.BufferedReader(
                new java.io.InputStreamReader(getAssets().open(fileName), "UTF-8"))) {
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line).append('\n');
            }
        } catch (Exception e) {
            Log.e(TAG, "readAssetAsString failed for " + fileName, e);
        }
        return sb.toString();
    }

    /** 유튜브 iframe(player.html)에서 JS가 이걸 통해 안드로이드로 이벤트를 보냄. */
    private class JsBridge {
        @JavascriptInterface
        public void onEvent(String json) {
            // addJavascriptInterface로 노출된 메서드는 웹뷰 전용 스레드에서 불림(메인
            // 스레드 아님) — startForeground/stopForeground는 메인 스레드에서 호출.
            mainHandler.post(() -> {
                try {
                    JSONObject obj = new JSONObject(json);
                    String type = obj.optString("type");
                    // (§73 진단용) player.html에서 오는 모든 이벤트를 그대로 로그로 남김 —
                    // Logcat에서 "PlaybackService"로 필터링하면 ready/stateChange/error/
                    // timeUpdate가 실제로 어떤 값으로 오는지 한 군데서 볼 수 있음.
                    Log.d(TAG, "event from player.html: " + json);
                    if ("ready".equals(type) || "stateChange".equals(type)) {
                        // state == 1 은 YT.PlayerState.PLAYING.
                        // (§73 추가 — 알림에 재생/일시정지 버튼을 넣으면서 정책 변경) 예전엔
                        // 재생 중일 때만 알림을 띄우고 멈추면 완전히 내렸는데(§72 결정),
                        // 이제 알림에서 바로 다시 재생할 수 있게 됐으니 일시정지(2) 중엔
                        // 알림을 유지하고 버튼만 "재생" 아이콘으로 바꿔줌. 완전히 끝났을
                        // 때(0)만 알림을 내림(스포티파이 등도 곡이 끝나 대기 상태가 되면
                        // 비슷하게 처리함).
                        int state = obj.optInt("state", -99);
                        if (state == 1) {
                            isPlaying = true;
                            startForeground(NOTIFICATION_ID, buildNotification());
                        } else if (state == 2) {
                            isPlaying = false;
                            startForeground(NOTIFICATION_ID, buildNotification());
                        } else if (state == 0) {
                            isPlaying = false;
                            stopForeground(false);
                        }
                    } else if ("autoAdvance".equals(type)) {
                        // (§73 후속) player.html이 화면 웹뷰를 거치지 않고 스스로 다음 곡으로
                        // 넘어갔을 때 오는 이벤트 — 알림 제목/아티스트를 새 곡으로 갱신하고,
                        // 계속 재생 중이므로 알림을 내리지 않고 그대로 startForeground 재호출.
                        currentTitle = obj.optString("title", currentTitle);
                        currentArtist = obj.optString("artist", currentArtist);
                        isPlaying = true;
                        startForeground(NOTIFICATION_ID, buildNotification());
                    }
                    if (listener != null) listener.onEvent(type, obj);
                } catch (Exception e) {
                    Log.e(TAG, "onEvent parse error", e);
                }
            });
        }
    }

    public void updateNowPlaying(String title, String artist) {
        this.currentTitle = title;
        this.currentArtist = artist;
    }

    private Notification buildNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Unbeat 재생", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("음악 재생 중 표시되는 알림");
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.createNotificationChannel(channel);
        }

        Intent intent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, intent, flags);

        Notification.Builder builder = new Notification.Builder(getApplicationContext())
                .setContentTitle(currentTitle)
                .setContentText(currentArtist)
                .setSmallIcon(getApplicationInfo().icon != 0
                        ? getApplicationInfo().icon
                        : android.R.drawable.ic_media_play)
                .setOngoing(true)
                .setContentIntent(contentIntent);

        int iconResId = getResources().getIdentifier("ic_launcher_foreground", "mipmap", getPackageName());
        if (iconResId == 0) {
            iconResId = getResources().getIdentifier("ic_launcher_foreground", "drawable", getPackageName());
        }
        if (iconResId != 0) {
            builder.setSmallIcon(iconResId);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder.setChannelId(CHANNEL_ID);
        }

        // (§73 추가) 재생/일시정지 토글 버튼 — 안드로이드 표준 미디어 아이콘
        // (android.R.drawable.ic_media_play/pause)을 써서 별도 아이콘 리소스 없이 구현.
        // 버튼을 누르면 이 서비스가 ACTION_TOGGLE_PLAY_PAUSE로 다시 시작되고,
        // onStartCommand에서 현재 isPlaying 값 기준으로 play()/pause()를 호출함.
        Intent toggleIntent = new Intent(this, PlaybackService.class).setAction(ACTION_TOGGLE_PLAY_PAUSE);
        PendingIntent togglePendingIntent = PendingIntent.getService(this, 1, toggleIntent, flags);
        int toggleIcon = isPlaying ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play;
        CharSequence toggleLabel = isPlaying ? "일시정지" : "재생";
        builder.addAction(new Notification.Action.Builder(
                android.graphics.drawable.Icon.createWithResource(this, toggleIcon),
                toggleLabel,
                togglePendingIntent).build());

        return builder.build();
    }

    // --- 플러그인(PlaybackPlugin.java)에서 부르는 컨트롤 메서드들 ---
    // 모두 webView.evaluateJavascript(...)로 player.html에 정의된 window.native* 함수를
    // 직접 호출함 — 서비스 프로세스 내부의 같은 웹뷰 인스턴스라 IPC 없이 바로 접근 가능.

    public void loadAndPlay(String videoId) {
        runJs("window.nativeLoadAndPlay(" + JSONObject.quote(videoId) + ")");
    }

    // (§73 후속) "다음 곡 1곡 미리보기"를 헤드리스 웹뷰에 미리 넘겨둠 — 화면이 꺼져서 액티비티
    // 웹뷰가 못 도는 동안에도 이 웹뷰 스스로 다음 곡으로 넘어갈 수 있게 하기 위함. jsonArrayString은
    // [{"videoId":"...","title":"...","artist":"..."}] 형태의 JSON 문자열.
    public void setQueue(String jsonArrayString) {
        runJs("window.nativeSetQueue(" + JSONObject.quote(jsonArrayString) + ")");
    }

    public void play() {
        runJs("window.nativePlay()");
    }

    public void pause() {
        runJs("window.nativePause()");
    }

    public void seekTo(double seconds) {
        runJs("window.nativeSeekTo(" + seconds + ")");
    }

    public void setVolume(int volume) {
        runJs("window.nativeSetVolume(" + volume + ")");
    }

    public void mute() {
        runJs("window.nativeMute()");
    }

    public void unmute() {
        runJs("window.nativeUnmute()");
    }

    private void runJs(String script) {
        // evaluateJavascript는 메인(UI) 스레드에서만 호출 가능 — 이 메서드를 부르는 쪽
        // (PlaybackPlugin의 @PluginMethod들)은 Capacitor 전용 백그라운드 스레드에서
        // 실행되므로 반드시 메인 스레드로 다시 포스팅해야 함.
        mainHandler.post(() -> {
            if (webView == null) return;
            // (§73 타이밍 버그 수정) 페이지 로딩이 아직 안 끝났으면 큐에 쌓아뒀다가
            // onPageFinished에서 순서대로 실행 — 앱 켜자마자 바로 재생 눌러도 안전하게 함.
            if (!pageLoaded) {
                pendingScripts.add(script);
                return;
            }
            webView.evaluateJavascript(script, null);
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // (§73 추가) 알림의 재생/일시정지 버튼을 눌렀을 때 여기로 들어옴.
        if (intent != null && ACTION_TOGGLE_PLAY_PAUSE.equals(intent.getAction())) {
            if (isPlaying) {
                pause();
            } else {
                play();
            }
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
