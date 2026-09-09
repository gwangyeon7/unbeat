package com.unbeat.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Build;
import android.os.IBinder;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/**
 * (§73) MiniPlayer.tsx(JS) <-> PlaybackService(네이티브, 헤드리스 웹뷰) 사이의 다리.
 * JS 쪽에서 보면 YT.Player와 거의 같은 모양의 메서드를 그대로 호출하는 것처럼 쓸 수 있게
 * frontend/lib/nativePlayer.ts에서 이 플러그인을 감싸서 어댑터로 노출함.
 */
@CapacitorPlugin(name = "PlaybackBridge")
public class PlaybackPlugin extends Plugin implements PlaybackService.PlaybackListener {

    private PlaybackService service;
    private boolean isBound = false;

    private final ServiceConnection connection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName name, IBinder binder) {
            service = ((PlaybackService.LocalBinder) binder).getService();
            service.setListener(PlaybackPlugin.this);
            isBound = true;
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            service = null;
            isBound = false;
        }
    };

    @Override
    public void load() {
        // (§73) 여기서 startForegroundService()를 바로 부르면, 안드로이드가 "몇 초 안에
        // startForeground()를 안 부르면 크래시(ForegroundServiceDidNotStartInTimeException,
        // API 31+)" 규칙을 적용함 — 근데 우리는 실제로 재생이 시작될 때(유튜브 iframe이
        // PLAYING 상태가 될 때)까지 알림을 안 띄우기로 했었음(§72, 안 쓸 때도 알림이 뜨면
        // 배터리 최적화 예외 대상처럼 보여 UX가 나쁘다는 이유). bindService(...)만으로도
        // BIND_AUTO_CREATE 덕분에 서비스가 시작되고(이 규칙 적용 대상이 아님), 나중에
        // PlaybackService 안에서 재생 상태에 따라 원하는 시점에 startForeground()를
        // 직접 호출하는 방식이라 이 타이밍 제약을 피할 수 있음.
        Context context = getContext();
        Intent intent = new Intent(context, PlaybackService.class);
        context.bindService(intent, connection, Context.BIND_AUTO_CREATE);
    }

    @PluginMethod
    public void loadAndPlay(PluginCall call) {
        String videoId = call.getString("videoId");
        String title = call.getString("title", "Unbeat");
        String artist = call.getString("artist", "");
        if (service != null) {
            service.updateNowPlaying(title, artist);
            service.loadAndPlay(videoId);
        }
        call.resolve();
    }

    @PluginMethod
    public void play(PluginCall call) {
        if (service != null) service.play();
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        if (service != null) service.pause();
        call.resolve();
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        Double seconds = call.getDouble("seconds", 0.0);
        if (service != null) service.seekTo(seconds);
        call.resolve();
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        Integer volume = call.getInt("volume", 100);
        if (service != null) service.setVolume(volume);
        call.resolve();
    }

    @PluginMethod
    public void mute(PluginCall call) {
        if (service != null) service.mute();
        call.resolve();
    }

    @PluginMethod
    public void unmute(PluginCall call) {
        if (service != null) service.unmute();
        call.resolve();
    }

    // (§73 후속) MiniPlayer.tsx가 "다음 곡 1곡 미리보기"(videoId까지 이미 resolve된 것)를
    // 넘기면 그대로 헤드리스 웹뷰에 전달 — 화면 꺼짐 상태에서 자동전환에 씀.
    @PluginMethod
    public void setQueue(PluginCall call) {
        com.getcapacitor.JSArray tracks = call.getArray("tracks");
        if (service != null) {
            service.setQueue(tracks != null ? tracks.toString() : "[]");
        }
        call.resolve();
    }

    // PlaybackService.PlaybackListener — 헤드리스 웹뷰(player.html)에서 온 이벤트를
    // Capacitor 이벤트로 그대로 JS에 넘김. state 숫자는 YT.PlayerState 값 그대로라
    // nativePlayer.ts 쪽에서 변환 없이 기존 MiniPlayer.tsx onStateChange 콜백에 넘길 수 있음.
    @Override
    public void onEvent(String type, JSONObject data) {
        JSObject payload = new JSObject();
        try {
            if (data.has("state")) payload.put("state", data.getInt("state"));
            if (data.has("duration")) payload.put("duration", data.getDouble("duration"));
            if (data.has("currentTime")) payload.put("currentTime", data.getDouble("currentTime"));
            // (§73 후속) autoAdvance 이벤트용 — 새로 넘어간 곡 정보를 JS 쪽에도 그대로 전달.
            if (data.has("videoId")) payload.put("videoId", data.getString("videoId"));
            if (data.has("title")) payload.put("title", data.getString("title"));
            if (data.has("artist")) payload.put("artist", data.getString("artist"));
        } catch (Exception ignored) {}
        notifyListeners(type, payload);
    }

    @Override
    protected void handleOnDestroy() {
        if (isBound) {
            getContext().unbindService(connection);
            isBound = false;
        }
        super.handleOnDestroy();
    }
}
