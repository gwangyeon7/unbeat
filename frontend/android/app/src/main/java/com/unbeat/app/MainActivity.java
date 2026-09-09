package com.unbeat.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // (§72 추가) Android 13(API 33)+ 에서는 알림을 화면에 "보여주는" 것 자체에 런타임 권한
    // (POST_NOTIFICATIONS)이 필요함. cordova-plugin-background-mode는 옛날 플러그인이라
    // 이걸 전혀 요청하지 않아서, enable()이 성공해도(크래시도 없고 이벤트도 정상 발생해도)
    // 알림바에 아무것도 안 뜨는 원인이었음. 앱 시작 시 여기서 직접 요청함.
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // (§73 추가) 커스텀 플러그인은 npm 패키지가 아니라 이 앱 모듈 안에 직접 넣은
        // 자바 클래스라서 자동으로 스캔되지 않음 — super.onCreate() 전에 수동으로 등록해야
        // 브릿지가 초기화될 때 같이 로드됨.
        registerPlugin(PlaybackPlugin.class);
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                        this,
                        new String[]{Manifest.permission.POST_NOTIFICATIONS},
                        1001
                );
            }
        }
    }
}
