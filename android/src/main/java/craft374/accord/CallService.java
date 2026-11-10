package craft374.accord;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.IBinder;
import java.util.function.Consumer;

// 화면이 꺼지거나 다른 앱으로 가도 통화(마이크)와 사운드 공유가 이어지게 하는 포그라운드 서비스.
// 안드로이드 14부터 MediaProjection 은 mediaProjection 타입 포그라운드 서비스가 켜진 뒤에만 받을 수 있어서
// 사운드 공유 동의 결과도 여기서 받아 MediaProjection 으로 바꿔 Activity 에 넘긴다.
public class CallService extends Service {
    static final String EXTRA_CODE = "code";
    static final String EXTRA_DATA = "data";

    // 사운드 공유 동의 결과를 받을 곳(MainActivity). 실패하면 null 이 넘어간다.
    static Consumer<MediaProjection> onProjection;

    private boolean foreground;

    // projection == null 이면 통화 유지만. 호출 전에 RECORD_AUDIO 권한이 있어야 한다.
    static void start(Context context, int code, Intent projection) {
        Intent intent = new Intent(context, CallService.class);
        if (projection != null) intent.putExtra(EXTRA_CODE, code).putExtra(EXTRA_DATA, projection);
        context.startForegroundService(intent);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Intent data = intent == null ? null : intent.getParcelableExtra(EXTRA_DATA);
        // 이미 켜져 있는데 통화 유지만 다시 요청(마이크를 다시 잡을 때마다 온다)하면 그대로 둔다.
        // startForeground 를 마이크 타입만으로 다시 부르면 mediaProjection 타입이 빠져 시스템이 사운드 공유를 끊고,
        // 백그라운드(화면 꺼짐 중 재연결)에서는 안드로이드 14 의 마이크 타입 제한에 걸려 예외 → stopSelf 로 통화까지 끊긴다.
        if (data == null && foreground) return START_NOT_STICKY;
        int type = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
        if (data != null) type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION;
        try {
            startForeground(1, buildNotification(), type);
            foreground = true;
        } catch (RuntimeException e) {
            if (data != null) deliver(null);
            if (!foreground) stopSelf(); // 이미 통화를 유지 중이면 사운드 공유만 실패로 끝낸다
            return START_NOT_STICKY;
        }
        if (data != null) {
            MediaProjection projection = null;
            try {
                projection = getSystemService(MediaProjectionManager.class)
                        .getMediaProjection(intent.getIntExtra(EXTRA_CODE, 0), data);
            } catch (RuntimeException ignored) {
            }
            deliver(projection);
        }
        return START_NOT_STICKY;
    }

    private static void deliver(MediaProjection projection) {
        if (onProjection != null) onProjection.accept(projection);
        else if (projection != null) projection.stop();
    }

    private Notification buildNotification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("call", "통화", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, "call")
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle("Accord")
                .setContentText("음성 연결 유지 중")
                .setContentIntent(open)
                .setOngoing(true)
                .build();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
