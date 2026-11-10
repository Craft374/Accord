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
import android.content.res.Configuration;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.os.HandlerThread;
import android.os.SystemClock;
import java.io.ByteArrayOutputStream;
import java.util.concurrent.atomic.AtomicBoolean;
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
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.security.cert.CertificateException;
import java.security.cert.X509Certificate;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
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
    private static final long PROJECTION_KEEP_MS = 3000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView web;
    private SharedPreferences prefs;
    private String serverOrigin = ""; // 런처에서 고른 서버(scheme://host[:port]) — 이 오리진만 신뢰한다
    private WebMessagePort control;
    private PermissionRequest pendingMic;
    private ValueCallback<Uri[]> pendingFiles;
    private View customView;
    private boolean keepPageAwake; // 통화 중(포그라운드 서비스가 켜진 동안)
    private WebChromeClient.CustomViewCallback customViewCallback;

    // 사운드 공유
    private MediaProjection projection;
    private volatile WebMessagePort pcmPort;
    private volatile boolean capturing;
    private boolean soundRequested; // 페이지가 시작을 요청했고 아직 끝나지 않음(동의 창이 떠 있는 동안 포함)
    private boolean displayUsed; // 이 projection 으로 VirtualDisplay 를 이미 만들었다(안드로이드 14부터 한 번만 된다)

    // 화면 공유
    private boolean screenRequested;
    private volatile boolean screenCapturing;
    private VirtualDisplay display;
    private volatile ImageReader reader;
    private HandlerThread screenThread;
    private WebMessagePort framePort;
    private int screenMaxSide = 1280;
    private volatile int screenFps = 15;
    private final AtomicBoolean framePending = new AtomicBoolean();
    // 아래 셋은 화면 캡처 스레드에서만 쓴다
    private Bitmap frameBitmap;
    private ByteBuffer framePad;
    private final ByteArrayOutputStream jpegOut = new ByteArrayOutputStream();
    private String lastFrame;
    private long lastSentAt;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("accord", MODE_PRIVATE);
        getWindow().setStatusBarColor(0xFF1E1F22);
        getWindow().setNavigationBarColor(0xFF1E1F22);
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            WebView.setWebContentsDebuggingEnabled(true); // chrome://inspect 로 디버깅
        }

        // 앱을 내리면 WebView 는 페이지를 '숨김'으로 바꾸고, 크로뮴은 숨김 페이지가 소리를 안 내면 1~2분 뒤 얼린다.
        // 그러면 사운드 공유 PCM 전달(페이지 메인 스레드 경유)과 통화가 멈추므로, 통화 중에는 보이는 상태로 둔다.
        web = new WebView(this) {
            @Override
            protected void onWindowVisibilityChanged(int visibility) {
                super.onWindowVisibilityChanged(keepPageAwake ? View.VISIBLE : visibility);
            }
        };
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
        stopCallService();
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

    private void stopCallService() {
        stopSoundShare(false);
        stopScreenShare(false);
        releaseProjection.run();
        stopService(new Intent(this, CallService.class));
        keepPageAwake = false;
    }

    private void backToLauncher() {
        stopCallService();
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
            // 새로고침·이동하면 이전 페이지의 포트와 사운드·화면 공유는 끝난다.
            stopSoundShare(false);
            stopScreenShare(false);
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
            return sha256(error.getCertificate().getX509Certificate().getEncoded());
        } catch (Exception e) {
            return null;
        }
    }

    private static String sha256(byte[] der) {
        try {
            return Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(der), Base64.NO_WRAP);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e); // SHA-256 은 모든 안드로이드에 있다
        }
    }

    // ===== 권한·파일 선택·전체 화면 =====

    private class Chrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            // 마이크·카메라만, 고른 서버 페이지에만 준다(PC 의 isTrustedPage). 다른 오리진 iframe 은 거부.
            List<String> asked = Arrays.asList(request.getResources());
            boolean wantsMic = asked.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
            boolean wantsCam = asked.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
            if ((!wantsMic && !wantsCam) || serverOrigin.isEmpty() || !serverOrigin.equals(originOf(request.getOrigin()))) {
                request.deny();
                return;
            }
            // 빠진 안드로이드 권한을 한 번에 묻고, 결과로 허용된 것만 준다(onRequestPermissionsResult).
            List<String> missing = new ArrayList<>();
            if (wantsMic && !hasMicPermission()) missing.add(Manifest.permission.RECORD_AUDIO);
            if (wantsCam && !hasPermission(Manifest.permission.CAMERA)) missing.add(Manifest.permission.CAMERA);
            if (missing.isEmpty()) {
                grantMedia(request);
                return;
            }
            if (Build.VERSION.SDK_INT >= 33 && !hasPermission(Manifest.permission.POST_NOTIFICATIONS)) {
                missing.add(Manifest.permission.POST_NOTIFICATIONS);
            }
            if (pendingMic != null) pendingMic.deny();
            pendingMic = request;
            requestPermissions(missing.toArray(new String[0]), REQ_MIC);
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

    private boolean hasPermission(String permission) {
        return checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasMicPermission() {
        return hasPermission(Manifest.permission.RECORD_AUDIO);
    }

    // 요청 중 안드로이드 권한이 있는 것만 준다. 하나도 없으면 거부.
    private void grantMedia(PermissionRequest request) {
        List<String> asked = Arrays.asList(request.getResources());
        List<String> grant = new ArrayList<>();
        if (asked.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE) && hasMicPermission()) {
            grant.add(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
        }
        if (asked.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE) && hasPermission(Manifest.permission.CAMERA)) {
            grant.add(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
        }
        if (grant.isEmpty()) {
            request.deny();
            return;
        }
        request.grant(grant.toArray(new String[0]));
        if (grant.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) startCallService();
    }

    // 방에 들어갔을 때(페이지의 call 메시지)와 마이크를 받았을 때 켠다. 직접 나가기·서버 선택·앱 종료 때 끈다.
    private void startCallService() {
        keepPageAwake = true;
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
        grantMedia(request);
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
                failProjection("denied");
                return;
            }
            try {
                CallService.start(this, resultCode, data); // → onProjection
            } catch (RuntimeException e) {
                failProjection("error");
            }
        }
    }

    // ===== 페이지와의 통신(control 포트) =====
    // 페이지 → 앱: JSON 문자열 {type: "download"|"save"|"soundStart"|"soundStop"|"screenStart"(maxSide, fps)|"screenStop"|"launcher"|"call"(active), ...}
    // 앱 → 페이지: {type: "sound"|"screen", state: "started"(ports[0] = PCM/프레임 포트)|"denied"|"error"|"stopped", message}

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
            case "screenStart":
                startScreenShare(msg.optInt("maxSide", 1280), msg.optInt("fps", 15));
                break;
            case "screenStop":
                stopScreenShare(false);
                break;
            case "screenConfig":
                setScreenConfig(msg.optInt("maxSide", screenMaxSide), msg.optInt("fps", screenFps));
                if (screenCapturing) resizeScreenCapture(getResources().getConfiguration().densityDpi);
                break;
            case "launcher":
                backToLauncher();
                break;
            case "call":
                if (msg.optBoolean("active")) startCallService();
                else stopCallService();
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

    private void sendScreen(String state, String message, WebMessagePort port) {
        if (!"started".equals(state)) screenRequested = false;
        if (control == null) return;
        try {
            JSONObject json = new JSONObject().put("type", "screen").put("state", state);
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
        // 자체 서명 인증서 서버(처음 접속 때 핀을 기억한 곳)는 시스템 DownloadManager 가 인증서를 믿지 않아 실패한다 → 앱이 직접 받는다.
        String pin = "https".equals(scheme) ? prefs.getString("certPin:" + uri.getAuthority(), null) : null;
        if (pin != null) {
            pinnedDownload(url, fileName, pin);
            return;
        }
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

    // 핀으로 기억한 인증서(SHA-256)와 똑같은 인증서일 때만 받는다. 인증서 자체를 확인했으므로 호스트 이름은 보지 않는다
    // (LAN IP 로 접속하면 인증서 CN 과 맞지 않는다). 다운로드 폴더에 바로 쓴다(IS_PENDING 으로 다 받기 전엔 숨김).
    private void pinnedDownload(String url, String fileName, String pin) {
        String cookie = CookieManager.getInstance().getCookie(url);
        String userAgent = web.getSettings().getUserAgentString();
        Toast.makeText(this, "다운로드를 시작했습니다: " + fileName, Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            boolean ok = false;
            Uri target = null;
            try {
                X509TrustManager pinned = new X509TrustManager() {
                    @Override
                    public void checkServerTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                        if (chain == null || chain.length == 0 || !pin.equals(sha256(chain[0].getEncoded()))) {
                            throw new CertificateException("인증서가 기억한 것과 다릅니다.");
                        }
                    }

                    @Override
                    public void checkClientTrusted(X509Certificate[] chain, String authType) throws CertificateException {
                        throw new CertificateException();
                    }

                    @Override
                    public X509Certificate[] getAcceptedIssuers() {
                        return new X509Certificate[0];
                    }
                };
                SSLContext tls = SSLContext.getInstance("TLS");
                tls.init(null, new TrustManager[]{pinned}, null);
                HttpsURLConnection conn = (HttpsURLConnection) new URL(url).openConnection();
                conn.setSSLSocketFactory(tls.getSocketFactory());
                conn.setHostnameVerifier((host, session) -> true);
                conn.setRequestProperty("User-Agent", userAgent);
                if (cookie != null) conn.setRequestProperty("Cookie", cookie);
                if (conn.getResponseCode() == 200) {
                    String mime = conn.getContentType();
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                    values.put(MediaStore.Downloads.MIME_TYPE, mime == null ? "application/octet-stream" : mime.split(";")[0]);
                    values.put(MediaStore.Downloads.IS_PENDING, 1);
                    target = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (target != null) {
                        try (InputStream in = conn.getInputStream(); OutputStream out = getContentResolver().openOutputStream(target)) {
                            byte[] buffer = new byte[64 * 1024];
                            for (int n; (n = in.read(buffer)) > 0; ) out.write(buffer, 0, n);
                        }
                        values.clear();
                        values.put(MediaStore.Downloads.IS_PENDING, 0);
                        getContentResolver().update(target, values, null, null);
                        ok = true;
                    }
                }
                conn.disconnect();
            } catch (Exception ignored) {
            }
            if (!ok && target != null) getContentResolver().delete(target, null, null);
            boolean saved = ok;
            main.post(() -> Toast.makeText(this,
                    saved ? "다운로드 폴더에 저장했습니다: " + fileName : "다운로드하지 못했습니다.",
                    Toast.LENGTH_SHORT).show());
        }).start();
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
        // 방금 끈 공유의 동의가 아직 살아 있으면(장치 변경·오디오 복구로 껐다 켬) 허용 창을 다시 띄우지 않는다.
        if (projection != null) {
            main.removeCallbacks(releaseProjection);
            startSoundCapture(false);
            return;
        }
        requestProjection();
    }

    // 사운드·화면 공유가 같이 쓰는 화면 캡처 동의 창. 결과는 onActivityResult → CallService → onProjection.
    private boolean projectionPending;

    private void requestProjection() {
        if (projectionPending) return; // 동의 창이 이미 떠 있으면 그 결과를 같이 쓴다
        MediaProjectionManager manager = getSystemService(MediaProjectionManager.class);
        Intent intent = Build.VERSION.SDK_INT >= 34
                ? manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
                : manager.createScreenCaptureIntent();
        try {
            startActivityForResult(intent, REQ_PROJECTION);
            projectionPending = true;
        } catch (ActivityNotFoundException e) {
            failProjection("error");
        }
    }

    private void failProjection(String state) {
        projectionPending = false;
        boolean denied = "denied".equals(state);
        if (soundRequested) sendSound(state, denied ? "사운드 공유를 허용하지 않았습니다." : "사운드 공유를 시작하지 못했습니다.");
        if (screenRequested) sendScreen(state, denied ? "화면 공유를 허용하지 않았습니다." : "화면 공유를 시작하지 못했습니다.", null);
    }

    private void onProjection(MediaProjection result) {
        main.post(() -> {
            if (result == null) {
                failProjection("error");
                return;
            }
            projectionPending = false;
            // 동의 창이 떠 있는 사이 페이지가 공유를 끄거나 새로고침했으면 버린다.
            if ((!soundRequested && !screenRequested) || control == null) {
                result.stop();
                return;
            }
            MediaProjection old = projection;
            projection = result;
            displayUsed = false;
            CallService.projectionActive = true;
            projection.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    // 시스템(알림·상태 표시줄)에서 공유를 끈 경우
                    if (projection != result) return;
                    projection = null;
                    CallService.projectionActive = false;
                    if (capturing) stopSoundShare(true);
                    if (screenCapturing) stopScreenShare(true);
                }
            }, main);
            // 화면 공유를 다시 켜느라 새 동의를 받은 경우(VirtualDisplay 는 동의 하나당 한 번): 하던 사운드 캡처를 새 동의로 옮긴다.
            if (old != null) old.stop();
            if (capturing) startSoundCapture(true);
            else if (soundRequested) startSoundCapture(false);
            if (screenRequested && !screenCapturing) startScreenCapture();
        });
    }

    // resume: 이미 공유 중인 사운드를 새 동의로 옮길 때 — 페이지의 PCM 포트를 그대로 쓴다.
    @SuppressLint("MissingPermission") // 맨 앞에서 hasMicPermission() 으로 확인한다
    private void startSoundCapture(boolean resume) {
        if (!hasMicPermission()) {
            stopSoundShare(false);
            sendSound("error", "사운드 공유에는 마이크 권한이 필요합니다.");
            return;
        }
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

        if (!resume) {
            WebMessagePort[] channel = web.createWebMessageChannel();
            pcmPort = channel[0];
            sendSound("started", null, channel[1]);
        }
        capturing = true;
        WebMessagePort port = pcmPort;
        AudioRecord started = record;
        new Thread(() -> captureLoop(started, port), "accord-sound-share").start();
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
        if (projection != null) {
            main.removeCallbacks(releaseProjection);
            main.postDelayed(releaseProjection, PROJECTION_KEEP_MS);
        }
        if (notify) sendSound("stopped", "사운드 공유가 종료되었습니다.");
    }

    // 아무도 안 쓰는 동의(MediaProjection)를 놓는다. stopSoundShare 는 PROJECTION_KEEP_MS 뒤에, 통화 종료는 바로 부른다.
    private final Runnable releaseProjection = this::releaseProjectionNow;

    private void releaseProjectionNow() {
        main.removeCallbacks(releaseProjection);
        if (capturing || screenCapturing) return;
        MediaProjection current = projection;
        projection = null;
        CallService.projectionActive = false;
        if (current != null) current.stop();
    }

    // ===== 화면 공유 =====
    // MediaProjection → VirtualDisplay → ImageReader 로 화면을 받아 JPEG(base64) 프레임으로 프레임 포트에 보낸다.
    // 페이지는 프레임을 VideoFrame 으로 바꿔 영상 트랙을 만든다. 프레임마다 독립이라 몇 장 빠져도 깨지지 않는다.
    // ponytail: JPEG 프레임(1280px·15fps 기준 대략 1~2MB/s). 화질·배터리가 아쉬우면 MediaCodec H.264 + 페이지 WebCodecs 로 바꾼다.

    private void startScreenShare(int maxSide, int fps) {
        if (screenRequested) return;
        screenRequested = true;
        setScreenConfig(maxSide, fps);
        if (projection != null && !displayUsed) {
            // 사운드 공유로 받아 둔 동의가 있으면 다시 묻지 않는다
            main.removeCallbacks(releaseProjection);
            startScreenCapture();
            return;
        }
        requestProjection();
    }

    private void setScreenConfig(int maxSide, int fps) {
        screenMaxSide = Math.max(480, Math.min(1920, maxSide));
        screenFps = Math.max(5, Math.min(30, fps));
    }

    // 실제 화면 크기(회전·폴드 상태 반영)를 긴 변 screenMaxSide 이하, 짝수로 줄인다.
    private int[] screenSize() {
        Rect bounds = getWindowManager().getMaximumWindowMetrics().getBounds();
        int w = bounds.width();
        int h = bounds.height();
        float scale = Math.min(1f, screenMaxSide / (float) Math.max(w, h));
        return new int[]{Math.max(2, Math.round(w * scale) & ~1), Math.max(2, Math.round(h * scale) & ~1)};
    }

    private void startScreenCapture() {
        int[] size = screenSize();
        try {
            reader = ImageReader.newInstance(size[0], size[1], PixelFormat.RGBA_8888, 2);
            display = projection.createVirtualDisplay("accord-screen", size[0], size[1],
                    getResources().getConfiguration().densityDpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                    reader.getSurface(), null, null);
            displayUsed = true;
        } catch (RuntimeException e) {
            stopScreenShare(false);
            sendScreen("error", "화면 캡처를 시작하지 못했습니다.", null);
            return;
        }
        WebMessagePort[] channel = web.createWebMessageChannel();
        framePort = channel[0];
        sendScreen("started", null, channel[1]);
        screenCapturing = true;
        screenThread = new HandlerThread("accord-screen");
        screenThread.start();
        Handler handler = new Handler(screenThread.getLooper());
        WebMessagePort port = framePort;
        handler.post(new Runnable() {
            @Override
            public void run() {
                if (!screenCapturing || framePort != port) return;
                captureFrame(port);
                handler.postDelayed(this, 1000 / screenFps);
            }
        });
    }

    // 화면 캡처 스레드에서 돈다.
    private void captureFrame(WebMessagePort port) {
        ImageReader current = reader;
        if (current == null) return;
        Image image = null;
        try {
            image = current.acquireLatestImage();
        } catch (RuntimeException ignored) {
        }
        long now = SystemClock.uptimeMillis();
        String jpeg = null;
        if (image != null) {
            try {
                // 페이지가 아직 이전 프레임을 못 받았으면 이번 프레임은 버린다(밀리면 지연만 쌓인다).
                if (!framePending.get()) jpeg = lastFrame = encodeFrame(image);
            } catch (RuntimeException ignored) {
            } finally {
                image.close();
            }
        } else if (lastFrame != null && now - lastSentAt >= 1000) {
            // 화면이 그대로면 프레임이 안 나온다 — 1초마다 다시 보내 새로 들어온 사람도 화면을 보게 한다.
            jpeg = lastFrame;
        }
        if (jpeg == null || !framePending.compareAndSet(false, true)) return;
        lastSentAt = now;
        String frame = jpeg;
        main.post(() -> {
            framePending.set(false);
            if (framePort == port) port.postMessage(new WebMessage(frame));
        });
    }

    private String encodeFrame(Image image) {
        Image.Plane plane = image.getPlanes()[0];
        int width = image.getWidth();
        int height = image.getHeight();
        // 줄 끝에 패딩이 붙을 수 있다: rowStride/pixelStride 폭으로 받은 뒤 잘라낸다(안 하면 영상이 기울어진다).
        int paddedWidth = plane.getRowStride() / plane.getPixelStride();
        if (frameBitmap == null || frameBitmap.getWidth() != paddedWidth || frameBitmap.getHeight() != height) {
            if (frameBitmap != null) frameBitmap.recycle();
            frameBitmap = Bitmap.createBitmap(paddedWidth, height, Bitmap.Config.ARGB_8888);
        }
        ByteBuffer pixels = plane.getBuffer();
        pixels.rewind();
        int need = paddedWidth * height * 4;
        if (pixels.remaining() < need) {
            // 마지막 줄에는 패딩이 없는 기기가 있어 버퍼가 조금 짧다 — 모자란 만큼 채운 버퍼로 옮긴다.
            if (framePad == null || framePad.capacity() < need) framePad = ByteBuffer.allocateDirect(need);
            framePad.clear();
            framePad.put(pixels);
            framePad.rewind();
            pixels = framePad;
        }
        frameBitmap.copyPixelsFromBuffer(pixels);
        Bitmap frame = paddedWidth == width ? frameBitmap : Bitmap.createBitmap(frameBitmap, 0, 0, width, height);
        jpegOut.reset();
        frame.compress(Bitmap.CompressFormat.JPEG, 70, jpegOut);
        if (frame != frameBitmap) frame.recycle();
        return Base64.encodeToString(jpegOut.toByteArray(), Base64.NO_WRAP);
    }

    // 회전·폴드 접고 펴기·해상도 설정 변경: VirtualDisplay 를 새로 만들 수 없으니(동의 하나당 한 번) 크기만 바꾸고 새 ImageReader 를 붙인다.
    @Override
    public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        if (screenCapturing) resizeScreenCapture(config.densityDpi);
    }

    private void resizeScreenCapture(int densityDpi) {
        if (display == null) return;
        int[] size = screenSize();
        ImageReader old = reader;
        if (old != null && old.getWidth() == size[0] && old.getHeight() == size[1]) return;
        ImageReader next = ImageReader.newInstance(size[0], size[1], PixelFormat.RGBA_8888, 2);
        display.resize(size[0], size[1], densityDpi);
        display.setSurface(next.getSurface());
        reader = next;
        closeOnScreenThread(old);
    }

    // ImageReader 는 캡처 스레드가 쓰는 중일 수 있어 그 스레드에서 닫는다.
    private void closeOnScreenThread(ImageReader old) {
        if (old == null) return;
        if (screenThread != null) new Handler(screenThread.getLooper()).post(old::close);
        else old.close();
    }

    private void stopScreenShare(boolean notify) {
        screenRequested = false;
        screenCapturing = false;
        if (framePort != null) framePort.close();
        framePort = null;
        VirtualDisplay oldDisplay = display;
        display = null;
        if (oldDisplay != null) oldDisplay.release();
        ImageReader oldReader = reader;
        reader = null;
        closeOnScreenThread(oldReader);
        if (screenThread != null) {
            new Handler(screenThread.getLooper()).post(() -> {
                lastFrame = null;
                if (frameBitmap != null) frameBitmap.recycle();
                frameBitmap = null;
            });
            screenThread.quitSafely();
            screenThread = null;
        }
        if (projection != null) {
            main.removeCallbacks(releaseProjection);
            main.postDelayed(releaseProjection, PROJECTION_KEEP_MS);
        }
        if (notify) sendScreen("stopped", "화면 공유가 종료되었습니다.", null);
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
