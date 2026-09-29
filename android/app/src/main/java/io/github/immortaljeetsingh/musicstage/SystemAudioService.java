package io.github.immortaljeetsingh.musicstage;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import io.github.immortaljeetsingh.musicstage.engine.StageConfig;
import org.json.JSONException;

/** Foreground service that owns the media projection, the audio loop and the session monitor. */
public final class SystemAudioService extends Service {
    static final String ACTION_START = "io.github.immortaljeetsingh.musicstage.action.START";
    static final String ACTION_STOP = "io.github.immortaljeetsingh.musicstage.action.STOP";
    private static final String EXTRA_CODE = "projectionResultCode";
    private static final String EXTRA_DATA = "projectionResultData";
    private static final String CHANNEL_ID = "system_wide";
    private static final int NOTIFICATION_ID = 42;
    private static final String PREFS = "stage";
    private static final String KEY_CONFIG = "config";

    private static volatile SystemAudioService instance;
    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaProjection projection;
    private volatile AudioLoop loop;
    private SessionMonitor monitor;

    static void start(Context context, int resultCode, Intent data) {
        SystemStatus.state = "starting";
        SystemStatus.message = "";
        Intent intent = new Intent(context, SystemAudioService.class).setAction(ACTION_START)
                .putExtra(EXTRA_CODE, resultCode).putExtra(EXTRA_DATA, data);
        context.startForegroundService(intent);
    }

    static void stop(Context context) {
        SystemAudioService service = instance;
        if (service != null) service.shutdown();
        else if (!"error".equals(SystemStatus.state)) SystemStatus.state = "off";
    }

    /** Stores the latest stage from the editor and applies it live when processing is running. */
    static void updateConfig(Context context, String json) {
        context.getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_CONFIG, json).apply();
        SystemAudioService service = instance;
        AudioLoop current = service == null ? null : service.loop;
        if (current == null) return;
        try {
            current.engine.setConfig(StageConfig.fromJson(json));
        } catch (JSONException | RuntimeException ignored) {
            // Keep the previous stage when the editor sends something unreadable.
        }
    }

    static StageConfig savedConfig(Context context) {
        String json = context.getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_CONFIG, null);
        if (json == null) return StageConfig.defaults();
        try {
            return StageConfig.fromJson(json);
        } catch (JSONException | RuntimeException e) {
            return StageConfig.defaults();
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (!ACTION_START.equals(action)) {
            shutdown();
            return START_NOT_STICKY;
        }
        createChannel();
        try {
            startForeground(NOTIFICATION_ID, notification(getString(R.string.notification_starting)), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION);
        } catch (RuntimeException e) {
            fail(getString(R.string.error_foreground));
            return START_NOT_STICKY;
        }
        if (projection != null) return START_NOT_STICKY;
        int code = intent.getIntExtra(EXTRA_CODE, 0);
        Intent data = Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(EXTRA_DATA, Intent.class) : legacyData(intent);
        try {
            MediaProjectionManager manager = getSystemService(MediaProjectionManager.class);
            projection = data == null ? null : manager.getMediaProjection(code, data);
            if (projection == null) throw new IllegalStateException(getString(R.string.error_projection));
            projection.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    main.post(SystemAudioService.this::shutdown);
                }
            }, main);
            instance = this;
            AudioLoop newLoop = new AudioLoop(projection, savedConfig(this), message -> main.post(() -> fail(message)));
            loop = newLoop;
            newLoop.start();
            monitor = new SessionMonitor(this, newLoop::lastSignalMillis, newLoop::lastOutputMillis,
                    newLoop::setOutputEnabled);
            monitor.start();
            SystemStatus.state = "running";
            SystemStatus.message = "";
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification(getString(R.string.notification_running)));
        } catch (RuntimeException e) {
            fail(e.getMessage() == null ? getString(R.string.error_projection) : e.getMessage());
        }
        return START_NOT_STICKY;
    }

    @SuppressWarnings("deprecation")
    private static Intent legacyData(Intent intent) {
        return intent.getParcelableExtra(EXTRA_DATA);
    }

    @Override
    public void onDestroy() {
        release();
        super.onDestroy();
    }

    private void fail(String message) {
        SystemStatus.state = "error";
        SystemStatus.message = message;
        shutdown();
    }

    void shutdown() {
        release();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void release() {
        if (instance == this) instance = null;
        SessionMonitor m = monitor;
        monitor = null;
        if (m != null) m.stop();
        AudioLoop l = loop;
        loop = null;
        if (l != null) l.shutdown();
        MediaProjection p = projection;
        projection = null;
        if (p != null) {
            try {
                p.stop();
            } catch (RuntimeException ignored) {
                // Already stopped by the system.
            }
        }
        if (!"error".equals(SystemStatus.state)) SystemStatus.state = "off";
        SystemStatus.clearSessions();
    }

    private void createChannel() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, getString(R.string.channel_name), NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(getString(R.string.channel_description));
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    private Notification notification(String text) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, SystemAudioService.class).setAction(ACTION_STOP),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder builder = new Notification.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_stage)
                .setContentTitle(getString(R.string.notification_title))
                .setContentText(text)
                .setContentIntent(open)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(Notification.CATEGORY_SERVICE)
                .addAction(new Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_stat_stage), getString(R.string.action_stop), stop).build());
        if (Build.VERSION.SDK_INT >= 31) builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return builder.build();
    }
}
