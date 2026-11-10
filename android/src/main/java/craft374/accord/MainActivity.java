package craft374.accord;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionConfig;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebMessage;
import android.webkit.WebMessagePort;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.security.MessageDigest;
import java.util.Arrays;
import org.json.JSONObject;

// PC 앱(electron/main.js)과 같은 역할: 서버 주소 입력 화면(shell/)을 띄우고, 고른 서버의 웹 클라이언트를 그대로 연다.
// 페이지와는 메인 프레임에만 넘기는 WebMessagePort(control)로 이야기한다 — 업로드 HTML iframe 은 이 포트를 못 얻는다.
public class MainActivity extends Activity {
    private static final String LAUNCHER_URL = "file:///android_asset/index.html";
    private static final String DEFAULT_SERVER = "https://demo-accord.kro.kr";
    private static final int REQ_MIC = 1;
    private static final int REQ_FILES = 2;
    private static final int REQ_PROJECTION = 3;
    private static final int SAMPLE_RATE = 48000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView web;
    private SharedPreferences prefs;
    private String serverOrigin = ""; // 런처에서 고른 서버(scheme://host[:port]) — 이 오리진만 신뢰한다
    private WebMessagePort control;
    private PermissionRequest pendingMic;
    private ValueCallback<Uri[]> pendingFiles;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;

    // 사운드 공유
    private MediaProjection projection;
    private volatile WebMessagePort pcmPort;
    private volatile boolean capturing;
    private boolean soundRequested; // 페이지가 시작을 요청했고 아직 끝나지 않음(동의 창이 떠 있는 동안 포함)

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("accord", MODE_PRIVATE);
        getWindow().setStatusBarColor(0xFF1E1F22);
        getWindow().setNavigationBarColor(0xFF1E1F22);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true); // chrome://inspect 로 디버깅
        }

        web = new WebView(this);
        root = new FrameLayout(this);
        root.setBackgroundColor(0xFF1E1F22);
        root.addView(web);
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // 없으면 상대 목소리가 재생되지 않는다
        web.addJavascriptInterface(new LauncherBridge(), "AccordAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, userAgent, disposition, mime, length) ->
                download(url, URLUtil.guessFileName(url, disposition, mime)));

        CallService.onProjection = this::onProjection;
        web.loadUrl(LAUNCHER_URL);
    }

    @Override
    protected void onDestroy() {
        stopSoundShare(false);
        stopService(new Intent(this, CallService.class));
        CallService.onProjection = null;
        closeControl();
        web.destroy();
        super.onDestroy();
    }

    // ===== 탐색 =====

    private static String originOf(Uri uri) {
        return uri.getScheme() + "://" + uri.getAuthority();
    }

    // 웹 클라이언트는 서버 루트(/) 한 페이지다. 같은 서버라도 /uploads/... 같은 다른 경로는 앱 밖에서 연다.
    private boolean isAppPage(Uri uri) {
        if (serverOrigin.isEmpty() || !serverOrigin.equals(originOf(uri))) return false;
        String path = uri.getPath();
        return path == null || path.isEmpty() || path.equals("/");
    }

    private void openExternal(Uri uri) {
        String scheme = uri.getScheme();
        if (!"http".equals(scheme) && !"https".equals(scheme) && !"mailto".equals(scheme)) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    private void backToLauncher() {
        stopSoundShare(false);
        stopService(new Intent(this, CallService.class));
        closeControl();
        serverOrigin = "";
        web.loadUrl(LAUNCHER_URL);
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {
            customViewCallback.onCustomViewHidden();
            return;
        }
        String current = web.getUrl();
        if (current == null || current.startsWith("file:")) {
            super.onBackPressed();
            return;
        }
        // 뒤로가기로 바로 나가면 통화가 끊기니 먼저 묻는다. PC 의 confirmServerChange 와 같은 문구.
        new AlertDialog.Builder(this)
                .setMessage("서버를 변경하면 지금 통화가 끊기고, 나가 있는 동안 DM 알림도 받을 수 없습니다. 서버 선택 화면으로 나갈까요?")
                .setPositiveButton("서버 선택", (d, w) -> backToLauncher())
                .setNeutralButton("앱 내리기", (d, w) -> moveTaskToBack(true))
                .setNegativeButton("취소", null)
                .show();
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) return false;
            Uri uri = request.getUrl();
            String current = view.getUrl();
            String scheme = uri.getScheme();
            // 런처에서 서버로 들어가는 이동: 그 서버를 신뢰 오리진으로 기억한다(PC 의 serverHost).
            if (current != null && current.startsWith("file:") && ("http".equals(scheme) || "https".equals(scheme))) {
                serverOrigin = originOf(uri);
                return false;
            }
            if (isAppPage(uri)) return false;
            openExternal(uri);
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            // 새로고침·이동하면 이전 페이지의 포트와 사운드 공유는 끝난다.
            stopSoundShare(false);
            closeControl();
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (url != null && isAppPage(Uri.parse(url))) openControl();
        }

        // 자체 서명 인증서(npm run server:https): PC 와 같이 처음 접속한 서버 인증서를 기억하고(TOFU),
        // 나중에 바뀌면 묻는다. 고른 서버가 아닌 곳의 인증서 오류는 그냥 거부한다.
        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            Uri uri = Uri.parse(error.getUrl());
            String host = uri.getAuthority();
            String fingerprint = fingerprint(error);
            if (fingerprint == null || serverOrigin.isEmpty() || !serverOrigin.equals(originOf(uri))) {
                handler.cancel();
                return;
            }
            String key = "certPin:" + host;
            String pinned = prefs.getString(key, null);
            if (fingerprint.equals(pinned)) {
                handler.proceed();
                return;
            }
            if (pinned == null) {
                prefs.edit().putString(key, fingerprint).apply();
                handler.proceed();
                return;
            }
            new AlertDialog.Builder(MainActivity.this)
                    .setTitle("서버 인증서가 바뀌었습니다")
                    .setMessage(host + " 서버의 인증서가 이전 접속 때와 다릅니다.\n\n서버 인증서를 새로 만든 게 아니라면 누군가 연결을 가로채고 있을 수 있습니다. 확실할 때만 신뢰하세요.")
                    .setPositiveButton("새 인증서 신뢰", (d, w) -> {
                        prefs.edit().putString(key, fingerprint).apply();
                        handler.proceed();
                    })
                    .setNegativeButton("연결 안 함", (d, w) -> handler.cancel())
                    .setOnCancelListener(d -> handler.cancel())
                    .show();
        }
    }

    private static String fingerprint(SslError error) {
        try {
            byte[] der = error.getCertificate().getX509Certificate().getEncoded();
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(der);
            return Base64.encodeToString(hash, Base64.NO_WRAP);
        } catch (Exception e) {
            return null;
        }
    }

    // ===== 권한·파일 선택·전체 화면 =====

    private class Chrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            // 마이크만, 고른 서버 페이지에만 준다(PC 의 isTrustedPage). 카메라·다른 오리진 iframe 은 거부.
            boolean wantsMic = Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
            if (!wantsMic || serverOrigin.isEmpty() || !serverOrigin.equals(originOf(request.getOrigin()))) {
                request.deny();
                return;
            }
            if (hasMicPermission()) {
                grantMic(request);
                return;
            }
            if (pendingMic != null) pendingMic.deny();
            pendingMic = request;
            String[] perms = Build.VERSION.SDK_INT >= 33
                    ? new String[]{Manifest.permission.RECORD_AUDIO, Manifest.permission.POST_NOTIFICATIONS}
                    : new String[]{Manifest.permission.RECORD_AUDIO};
            requestPermissions(perms, REQ_MIC);
        }

        @Override
        public void onPermissionRequestCanceled(PermissionRequest request) {
            if (pendingMic == request) pendingMic = null;
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (pendingFiles != null) pendingFiles.onReceiveValue(null);
            pendingFiles = callback;
            Intent intent = params.createIntent();
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
            try {
                startActivityForResult(intent, REQ_FILES);
            } catch (ActivityNotFoundException e) {
                pendingFiles = null;
                return false;
            }
            return true;
        }

        // 화면 공유 보기의 전체 화면(requestFullscreen).
        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (customView != null) {
                callback.onCustomViewHidden();
                return;
            }
            customView = view;
            customViewCallback = callback;
            root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }

        @Override
        public void onHideCustomView() {
            if (customView == null) return;
            root.removeView(customView);
            customView = null;
            customViewCallback = null;
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        }
    }

    private boolean hasMicPermission() {
        return checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private void grantMic(PermissionRequest request) {
        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        startCallService();
    }

    private void startCallService() {
        try {
            CallService.start(this, 0, null);
        } catch (RuntimeException ignored) {
            // 백그라운드에서는 시작할 수 없다(이미 켜져 있으면 그대로 유지된다).
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (requestCode != REQ_MIC || pendingMic == null) return;
        PermissionRequest request = pendingMic;
        pendingMic = null;
        if (hasMicPermission()) grantMic(request);
        else request.deny();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILES) {
            if (pendingFiles == null) return;
            Uri[] picked = null;
            if (resultCode == RESULT_OK && data != null) {
                ClipData clip = data.getClipData();
                if (clip != null) {
                    picked = new Uri[clip.getItemCount()];
                    for (int i = 0; i < picked.length; i++) picked[i] = clip.getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    picked = new Uri[]{data.getData()};
                }
            }
            pendingFiles.onReceiveValue(picked);
            pendingFiles = null;
        } else if (requestCode == REQ_PROJECTION) {
            if (resultCode != RESULT_OK || data == null) {
                sendSound("denied", "사운드 공유를 허용하지 않았습니다.");
                return;
            }
            try {
                CallService.start(this, resultCode, data); // → onProjection
            } catch (RuntimeException e) {
                sendSound("error", "사운드 공유를 시작하지 못했습니다.");
            }
        }
    }

    // ===== 페이지와의 통신(control 포트) =====
    // 페이지 → 앱: JSON 문자열 {type: "download"|"save"|"soundStart"|"soundStop"|"launcher", ...}
    // 앱 → 페이지: {type: "sound", state: "started"(ports[0] = PCM 포트)|"denied"|"error"|"stopped", message}

    private void openControl() {
        closeControl();
        WebMessagePort[] channel = web.createWebMessageChannel();
        control = channel[0];
        control.setWebMessageCallback(new WebMessagePort.WebMessageCallback() {
            @Override
            public void onMessage(WebMessagePort port, WebMessage message) {
                if (port == control) handleControl(message.getData());
            }
        }, main);
        web.postWebMessage(new WebMessage("accordAndroid", new WebMessagePort[]{channel[1]}), Uri.parse(serverOrigin));
    }

    private void closeControl() {
        if (control != null) control.close();
        control = null;
    }

    private void handleControl(String raw) {
        JSONObject msg;
        try {
            msg = new JSONObject(raw);
        } catch (Exception e) {
            return;
        }
        switch (msg.optString("type")) {
            case "download":
                download(msg.optString("url"), msg.optString("name"));
                break;
            case "save":
                saveDataUrl(msg.optString("dataUrl"), msg.optString("name"));
                break;
            case "soundStart":
                startSoundShare();
                break;
            case "soundStop":
                stopSoundShare(false);
                break;
            case "launcher":
                backToLauncher();
                break;
        }
    }

    private void sendSound(String state, String message) {
        sendSound(state, message, null);
    }

    private void sendSound(String state, String message, WebMessagePort port) {
        if (!"started".equals(state)) soundRequested = false;
        if (control == null) return;
        try {
            JSONObject json = new JSONObject().put("type", "sound").put("state", state);
            if (message != null) json.put("message", message);
            control.postMessage(new WebMessage(json.toString(), port == null ? null : new WebMessagePort[]{port}));
        } catch (Exception ignored) {
        }
    }

    // ===== 다운로드 =====

    private static String safeName(String name, String fallback) {
        String cleaned = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]", "_").trim();
        return cleaned.isEmpty() || cleaned.startsWith(".") ? fallback : cleaned;
    }

    private void download(String url, String name) {
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme();
        if (!"http".equals(scheme) && !"https".equals(scheme)) return;
        String fileName = safeName(name, URLUtil.guessFileName(url, null, null));
        try {
            DownloadManager.Request request = new DownloadManager.Request(uri)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
                    .addRequestHeader("User-Agent", web.getSettings().getUserAgentString());
            String cookie = CookieManager.getInstance().getCookie(url);
            if (cookie != null) request.addRequestHeader("Cookie", cookie);
            getSystemService(DownloadManager.class).enqueue(request);
            Toast.makeText(this, "다운로드를 시작했습니다: " + fileName, Toast.LENGTH_SHORT).show();
        } catch (RuntimeException e) {
            Toast.makeText(this, "다운로드하지 못했습니다.", Toast.LENGTH_SHORT).show();
        }
    }

    // blob:/data: 다운로드(이미지 저장, 화이트보드 PNG 등)는 페이지가 data URL 로 바꿔 보낸다.
    private void saveDataUrl(String dataUrl, String name) {
        int comma = dataUrl.indexOf(',');
        if (!dataUrl.startsWith("data:") || comma < 0) return;
        String meta = dataUrl.substring(5, comma);
        String mime = meta.split(";")[0];
        if (mime.isEmpty()) mime = "application/octet-stream";
        String fileName = safeName(name, "download");
        String finalMime = mime;
        new Thread(() -> {
            boolean ok = false;
            try {
                byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                values.put(MediaStore.Downloads.MIME_TYPE, finalMime);
                Uri target = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (target != null) {
                    try (OutputStream out = getContentResolver().openOutputStream(target)) {
                        out.write(bytes);
                        ok = true;
                    }
                }
            } catch (Exception ignored) {
            }
            boolean saved = ok;
            main.post(() -> Toast.makeText(this,
                    saved ? "다운로드 폴더에 저장했습니다: " + fileName : "저장하지 못했습니다.",
                    Toast.LENGTH_SHORT).show());
        }).start();
    }

    // ===== 사운드 공유 =====
    // AudioPlaybackCapture 로 다른 앱이 내는 소리(음악·영상·게임)를 48kHz 스테레오 float32 로 받아
    // PCM 포트로 20ms 마다 base64 문자열을 보낸다. 페이지는 program-audio-worklet 으로 재생해 WebRTC 트랙으로 보낸다.
    // Accord 자신이 내는 소리(상대 목소리·효과음)는 excludeUid 로 빼서 되울림이 생기지 않는다.

    private void startSoundShare() {
        if (soundRequested) return;
        soundRequested = true;
        if (!hasMicPermission()) {
            sendSound("error", "사운드 공유에는 마이크 권한이 필요합니다.");
            return;
        }
        MediaProjectionManager manager = getSystemService(MediaProjectionManager.class);
        Intent intent = Build.VERSION.SDK_INT >= 34
                ? manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
                : manager.createScreenCaptureIntent();
        try {
            startActivityForResult(intent, REQ_PROJECTION);
        } catch (ActivityNotFoundException e) {
            sendSound("error", "이 기기는 사운드 공유를 지원하지 않습니다.");
        }
    }

    @SuppressLint("MissingPermission") // 아래에서 hasMicPermission() 으로 확인한다(람다 안이라 lint 가 못 본다)
    private void onProjection(MediaProjection result) {
        main.post(() -> {
            if (result == null) {
                sendSound("error", "사운드 공유를 시작하지 못했습니다.");
                return;
            }
            // 동의 창이 떠 있는 사이 페이지가 공유를 끄거나 새로고침했으면 버린다.
            if (!soundRequested || control == null || projection != null) {
                result.stop();
                return;
            }
            if (!hasMicPermission()) {
                result.stop();
                sendSound("error", "사운드 공유에는 마이크 권한이 필요합니다.");
                return;
            }
            projection = result;
            projection.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    // 시스템(알림·상태 표시줄)에서 공유를 끈 경우
                    if (projection == result) stopSoundShare(true);
                }
            }, main);

            AudioRecord record = null;
            try {
                AudioPlaybackCaptureConfiguration config = new AudioPlaybackCaptureConfiguration.Builder(projection)
                        .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                        .addMatchingUsage(AudioAttributes.USAGE_GAME)
                        .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                        .excludeUid(Process.myUid()) // Accord 자신의 소리(상대 목소리·효과음)는 빼서 되돌아가지 않게
                        .build();
                AudioFormat format = new AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                        .setSampleRate(SAMPLE_RATE)
                        .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
                        .build();
                int minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_FLOAT);
                record = new AudioRecord.Builder()
                        .setAudioFormat(format)
                        .setBufferSizeInBytes(Math.max(minBuffer, SAMPLE_RATE * 2 * 4 / 10)) // 100ms
                        .setAudioPlaybackCaptureConfig(config)
                        .build();
                record.startRecording();
            } catch (Exception e) {
                if (record != null) record.release(); // startRecording 실패 시 네이티브 녹음 자원이 남지 않게
                stopSoundShare(false);
                sendSound("error", "사운드 캡처를 시작하지 못했습니다.");
                return;
            }

            WebMessagePort[] channel = web.createWebMessageChannel();
            pcmPort = channel[0];
            sendSound("started", null, channel[1]);
            capturing = true;
            WebMessagePort port = pcmPort;
            AudioRecord started = record;
            new Thread(() -> captureLoop(started, port), "accord-sound-share").start();
        });
    }

    private void captureLoop(AudioRecord record, WebMessagePort port) {
        float[] samples = new float[SAMPLE_RATE / 50 * 2]; // 20ms 스테레오
        ByteBuffer bytes = ByteBuffer.allocate(samples.length * 4).order(ByteOrder.LITTLE_ENDIAN);
        try {
            while (capturing && pcmPort == port) {
                int n = record.read(samples, 0, samples.length, AudioRecord.READ_BLOCKING);
                if (n <= 0) break;
                bytes.clear();
                bytes.asFloatBuffer().put(samples, 0, n);
                String chunk = Base64.encodeToString(bytes.array(), 0, n * 4, Base64.NO_WRAP);
                main.post(() -> {
                    if (pcmPort == port) port.postMessage(new WebMessage(chunk));
                });
            }
        } finally {
            try {
                record.stop();
            } catch (RuntimeException ignored) {
            }
            record.release();
        }
    }

    // notify: 페이지가 요청한 게 아니라 시스템이 끊은 경우 페이지에 알린다.
    private void stopSoundShare(boolean notify) {
        soundRequested = false;
        capturing = false;
        if (pcmPort != null) pcmPort.close();
        pcmPort = null;
        MediaProjection current = projection;
        projection = null;
        if (current != null) current.stop();
        if (notify) sendSound("stopped", "사운드 공유가 종료되었습니다.");
    }

    // ===== 런처(shell/launcher.js)가 읽는 값 =====
    // 모든 프레임에 노출되므로 해가 없는 읽기 전용 값만 둔다.
    private class LauncherBridge {
        @JavascriptInterface
        public String defaultServer() {
            return DEFAULT_SERVER;
        }

        @JavascriptInterface
        public String appVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (PackageManager.NameNotFoundException e) {
                return "";
            }
        }
    }
}
