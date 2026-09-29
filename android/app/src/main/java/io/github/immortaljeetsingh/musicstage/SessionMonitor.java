package io.github.immortaljeetsingh.musicstage;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.media.audiofx.AudioEffect;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Process;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.TreeSet;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Keeps the set of silenced app sessions in sync with what is playing. Only sessions whose app allows playback
 * capture are silenced, so apps that block capture (and unknown ones) keep playing their own unprocessed audio.
 */
final class SessionMonitor {
    private static final long POLL_MS = 1000;
    private final Context context;
    private final PackageManager packages;
    private final int myUid = Process.myUid();
    private final String myPackage;
    private final HandlerThread thread = new HandlerThread("MusicStageSessions");
    private final Map<Integer, SessionMute> mutes = new HashMap<>();
    private final Map<Integer, String> announced = new ConcurrentHashMap<>();
    private final Map<String, String> labels = new HashMap<>();
    private volatile Handler handler;
    private volatile boolean stopped;

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent intent) {
            int session = intent.getIntExtra(AudioEffect.EXTRA_AUDIO_SESSION, 0);
            if (session <= 0) return;
            String pkg = intent.getStringExtra(AudioEffect.EXTRA_PACKAGE_NAME);
            if (AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION.equals(intent.getAction())) announced.put(session, pkg == null ? "" : pkg);
            else announced.remove(session);
            Handler h = handler;
            if (h != null) h.post(SessionMonitor.this::refresh);
        }
    };

    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            if (stopped) return;
            refresh();
            Handler h = handler;
            if (h != null && !stopped) h.postDelayed(this, POLL_MS);
        }
    };

    SessionMonitor(Context context) {
        this.context = context.getApplicationContext();
        packages = this.context.getPackageManager();
        myPackage = this.context.getPackageName();
    }

    void start() {
        thread.start();
        Handler h = new Handler(thread.getLooper());
        handler = h;
        IntentFilter filter = new IntentFilter();
        filter.addAction(AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION);
        filter.addAction(AudioEffect.ACTION_CLOSE_AUDIO_EFFECT_CONTROL_SESSION);
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(receiver, filter, null, h, Context.RECEIVER_EXPORTED);
        else context.registerReceiver(receiver, filter, null, h);
        h.post(poll);
    }

    /** Stops polling and restores every silenced app's own output. */
    void stop() {
        stopped = true;
        try {
            context.unregisterReceiver(receiver);
        } catch (IllegalArgumentException ignored) {
            // Never registered.
        }
        Handler h = handler;
        handler = null;
        if (h == null) {
            thread.quitSafely();
            return;
        }
        h.removeCallbacksAndMessages(null);
        h.post(() -> {
            releaseAll();
            thread.quitSafely();
        });
    }

    private void refresh() {
        if (stopped) return;
        SystemDumps.Snapshot snapshot = SystemDumps.read();
        if (snapshot == null) {
            releaseAll();
            SystemStatus.clearSessions();
            SystemStatus.message = context.getString(R.string.status_no_session_access);
            return;
        }
        Map<Integer, String> wanted = new HashMap<>();
        TreeSet<String> blocked = new TreeSet<>();
        for (SystemDumps.Session s : snapshot.sessions) {
            if (s.uid == myUid || s.uid < Process.FIRST_APPLICATION_UID || !SystemDumps.capturable(s.usage)) continue;
            String pkg = packageFor(s.uid, snapshot);
            Boolean allowed = pkg == null ? null : snapshot.capture.get(pkg);
            if (allowed == null) continue; // unknown policy: leave the app untouched
            if (allowed) wanted.put(s.id, pkg);
            else blocked.add(label(pkg));
        }
        for (Map.Entry<Integer, String> e : announced.entrySet()) {
            String pkg = e.getValue();
            if (pkg.isEmpty() || pkg.equals(myPackage)) continue;
            Boolean allowed = snapshot.capture.get(pkg);
            if (Boolean.TRUE.equals(allowed)) wanted.put(e.getKey(), pkg);
            else if (Boolean.FALSE.equals(allowed)) blocked.add(label(pkg));
        }
        for (Iterator<Map.Entry<Integer, SessionMute>> it = mutes.entrySet().iterator(); it.hasNext(); ) {
            Map.Entry<Integer, SessionMute> e = it.next();
            if (!wanted.containsKey(e.getKey()) || e.getValue().isLost()) {
                e.getValue().release();
                it.remove();
            }
        }
        TreeSet<String> processed = new TreeSet<>(), failed = new TreeSet<>();
        for (Map.Entry<Integer, String> e : wanted.entrySet()) {
            if (!mutes.containsKey(e.getKey())) {
                try {
                    mutes.put(e.getKey(), new SessionMute(e.getKey()));
                } catch (RuntimeException ex) {
                    failed.add(label(e.getValue()));
                    continue;
                }
            }
            processed.add(label(e.getValue()));
        }
        SystemStatus.processed = processed.toArray(new String[0]);
        SystemStatus.blocked = blocked.toArray(new String[0]);
        SystemStatus.unmuted = failed.toArray(new String[0]);
        SystemStatus.message = "";
    }

    private String packageFor(int uid, SystemDumps.Snapshot snapshot) {
        String[] names = packages.getPackagesForUid(uid);
        if (names == null || names.length == 0) return null;
        for (String name : names) if (snapshot.capture.containsKey(name)) return name;
        return names[0];
    }

    private String label(String pkg) {
        String cached = labels.get(pkg);
        if (cached != null) return cached;
        String label = pkg;
        try {
            ApplicationInfo info = packages.getApplicationInfo(pkg, 0);
            label = packages.getApplicationLabel(info).toString();
        } catch (PackageManager.NameNotFoundException ignored) {
            // Not visible to this app; show the package name.
        }
        labels.put(pkg, label);
        return label;
    }

    private void releaseAll() {
        for (SessionMute mute : mutes.values()) mute.release();
        mutes.clear();
    }
}
