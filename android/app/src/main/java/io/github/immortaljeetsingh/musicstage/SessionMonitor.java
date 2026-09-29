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
import android.os.SystemClock;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.function.LongSupplier;

/**
 * Keeps silenced sessions aligned with active playback. Processing is admitted in two phases: one authoritative app
 * must produce fresh captured input, then AudioTrack must confirm a processed write before any direct output is muted.
 * Unknown, blocked, incomplete and multi-source cases fail open with both muting and processed output disabled.
 */
final class SessionMonitor {
    interface OutputGate {
        void setEnabled(boolean enabled);
    }

    private static final long POLL_MS = 1000;
    private static final long SIGNAL_RECENT_MS = 1500;
    private static final long HEALTH_TIMEOUT_MS = 3000;

    private static final class Target {
        final int uid;
        final String packageName;

        Target(int uid, String packageName) {
            this.uid = uid;
            this.packageName = packageName;
        }
    }

    private final Context context;
    private final PackageManager packages;
    private final LongSupplier lastSignal;
    private final LongSupplier lastOutput;
    private final OutputGate outputGate;
    private final int myUid = Process.myUid();
    private final HandlerThread thread = new HandlerThread("MusicStageSessions");
    private final ScheduledExecutorService safety = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "MusicStageSafety");
        t.setDaemon(true);
        return t;
    });
    private final Object muteLock = new Object();
    private final Map<Integer, SessionMute> mutes = new HashMap<>();
    private final Map<String, String> labels = new java.util.concurrent.ConcurrentHashMap<>();
    private volatile Handler handler;
    private volatile boolean stopped;

    // Probe state is guarded by muteLock so watchdog callbacks cannot race status publication or output gating.
    private int probeUid = -1;
    private long probeSignalBaseline;
    private long probeOutputBaseline;
    private long probeStartedAt;
    private boolean probeOutputEnabled;
    private boolean probeVerified;

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent intent) {
            Handler h = handler;
            if (h != null && (AudioEffect.ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION.equals(intent.getAction())
                    || AudioEffect.ACTION_CLOSE_AUDIO_EFFECT_CONTROL_SESSION.equals(intent.getAction()))) {
                // Broadcast session IDs are not trusted as ownership evidence; they only request an early full refresh.
                h.post(SessionMonitor.this::refresh);
            }
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

    SessionMonitor(Context context, LongSupplier lastSignal, LongSupplier lastOutput, OutputGate outputGate) {
        this.context = context.getApplicationContext();
        this.lastSignal = lastSignal;
        this.lastOutput = lastOutput;
        this.outputGate = outputGate;
        packages = this.context.getPackageManager();
    }

    void start() {
        outputGate.setEnabled(false);
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

    /** Restores direct output synchronously before the capture loop is stopped. */
    void stop() {
        stopped = true;
        releaseAll();
        safety.shutdownNow();
        try {
            context.unregisterReceiver(receiver);
        } catch (IllegalArgumentException ignored) {
            // Never registered.
        }
        Handler h = handler;
        handler = null;
        if (h != null) h.removeCallbacksAndMessages(null);
        thread.quitSafely();
    }

    private void refresh() {
        if (stopped) return;
        SystemDumps.Snapshot snapshot = SystemDumps.read();
        if (stopped) return;
        if (snapshot == null) {
            releaseAll();
            SystemStatus.clearSessions();
            SystemStatus.message = context.getString(R.string.status_no_session_access);
            return;
        }

        long signal = lastSignal.getAsLong();
        long output = lastOutput.getAsLong();
        long now = SystemClock.elapsedRealtime();
        Set<Integer> captureSources = new HashSet<>();
        Set<Integer> startedAppUids = new HashSet<>();
        Set<Integer> flaggedUids = new HashSet<>();
        for (SystemDumps.Player player : snapshot.players) {
            if (player.uid == myUid) continue;
            if ((player.flags & SystemDumps.FLAG_NO_MEDIA_PROJECTION) != 0) flaggedUids.add(player.uid);
            if (!"started".equalsIgnoreCase(player.state) || !SystemDumps.capturable(player.usage)) continue;
            captureSources.add(player.uid); // includes system UIDs because AudioPlaybackCapture can include them
            if (player.uid >= Process.FIRST_APPLICATION_UID) startedAppUids.add(player.uid);
        }

        Map<Integer, Target> eligible = new HashMap<>();
        TreeSet<String> blocked = new TreeSet<>();
        for (SystemDumps.Session session : snapshot.sessions) {
            if (session.uid == myUid || session.uid < Process.FIRST_APPLICATION_UID
                    || !startedAppUids.contains(session.uid) || !SystemDumps.capturable(session.usage)) continue;
            if (Build.VERSION.SDK_INT >= 31 && !hasStartedPlayer(snapshot, session)) continue;
            String pkg = packageFor(session.uid, snapshot);
            if (pkg == null) continue;
            if (flaggedUids.contains(session.uid)) {
                blocked.add(label(pkg));
                continue;
            }
            Boolean allowed = snapshot.capture.get(pkg);
            if (allowed == null) continue; // unknown manifest policy: never mute
            if (allowed) eligible.put(session.id, new Target(session.uid, pkg));
            else blocked.add(label(pkg));
        }
        for (int uid : flaggedUids) {
            if (!startedAppUids.contains(uid)) continue;
            String pkg = packageFor(uid, snapshot);
            if (pkg != null) blocked.add(label(pkg));
        }

        int candidateUid = -1;
        if (snapshot.playerTelemetryComplete && captureSources.size() == 1 && !eligible.isEmpty()) {
            int onlyUid = captureSources.iterator().next();
            if (onlyUid >= Process.FIRST_APPLICATION_UID && !flaggedUids.contains(onlyUid)) {
                boolean allOwned = true;
                for (Target target : eligible.values()) {
                    if (target.uid != onlyUid) {
                        allOwned = false;
                        break;
                    }
                }
                if (allOwned) candidateUid = onlyUid;
            }
        }

        synchronized (muteLock) {
            if (stopped) return;
            updateProbeLocked(candidateUid, signal, output, now);

            Map<Integer, Target> wanted = new HashMap<>();
            TreeSet<String> failOpen = new TreeSet<>();
            for (Map.Entry<Integer, Target> entry : eligible.entrySet()) {
                Target target = entry.getValue();
                if (probeVerified && target.uid == probeUid) wanted.put(entry.getKey(), target);
                else failOpen.add(label(target.packageName));
            }

            for (Iterator<Map.Entry<Integer, SessionMute>> it = mutes.entrySet().iterator(); it.hasNext(); ) {
                Map.Entry<Integer, SessionMute> entry = it.next();
                Target target = wanted.get(entry.getKey());
                SessionMute mute = entry.getValue();
                if (target == null || mute.isLost() || mute.uid != target.uid || !mute.packageName.equals(target.packageName)) {
                    mute.release();
                    it.remove();
                }
            }
            for (Map.Entry<Integer, Target> entry : wanted.entrySet()) {
                if (mutes.containsKey(entry.getKey())) continue;
                Target target = entry.getValue();
                try {
                    SessionMute mute = new SessionMute(entry.getKey(), target.uid, target.packageName,
                            safety, lastOutput, () -> emergencyRelease(target.packageName));
                    if (mute.isLost()) mute.release();
                    else mutes.put(entry.getKey(), mute);
                } catch (RuntimeException ex) {
                    failOpen.add(label(target.packageName));
                }
            }

            boolean allMuted = !wanted.isEmpty() && mutes.size() == wanted.size();
            if (allMuted) {
                for (SessionMute mute : mutes.values()) {
                    if (mute.isLost()) {
                        allMuted = false;
                        break;
                    }
                }
            }
            TreeSet<String> processed = new TreeSet<>();
            if (allMuted) {
                for (SessionMute mute : mutes.values()) mute.renewLease(now);
                for (Target target : wanted.values()) processed.add(label(target.packageName));
            } else if (!wanted.isEmpty()) {
                for (Target target : wanted.values()) failOpen.add(label(target.packageName));
                releaseAllLocked();
                resetProbeLocked(signal, output);
            }

            boolean probing = wanted.isEmpty() && probeOutputEnabled && !probeVerified;
            outputGate.setEnabled(allMuted || probing);
            SystemStatus.processed = processed.toArray(new String[0]);
            SystemStatus.blocked = blocked.toArray(new String[0]);
            SystemStatus.unmuted = failOpen.toArray(new String[0]);
            if (!snapshot.playerTelemetryComplete && !snapshot.sessions.isEmpty()) {
                SystemStatus.message = context.getString(R.string.status_player_details);
            } else if (captureSources.size() > 1 && !eligible.isEmpty()) {
                SystemStatus.message = context.getString(R.string.status_multiple_apps);
            } else if (!eligible.isEmpty() && processed.isEmpty()) {
                SystemStatus.message = context.getString(R.string.status_checking_capture);
            } else {
                SystemStatus.message = "";
            }
        }
    }

    private void updateProbeLocked(int candidateUid, long signal, long output, long now) {
        if (candidateUid != probeUid) {
            probeUid = candidateUid;
            resetProbeLocked(signal, output);
        }
        if (candidateUid < Process.FIRST_APPLICATION_UID) return;
        if (!probeOutputEnabled) {
            if (signal > probeSignalBaseline && isRecent(now, signal, SIGNAL_RECENT_MS)) {
                probeOutputEnabled = true;
                probeOutputBaseline = output;
                probeStartedAt = now;
            }
            return;
        }
        if (!probeVerified) {
            if (output > probeOutputBaseline && isRecent(now, output, SIGNAL_RECENT_MS)) {
                probeVerified = true;
            } else if (!isRecent(now, signal, HEALTH_TIMEOUT_MS)
                    || now - probeStartedAt >= HEALTH_TIMEOUT_MS) {
                resetProbeLocked(signal, output);
            }
            return;
        }
        if (!isRecent(now, signal, HEALTH_TIMEOUT_MS) || !isRecent(now, output, HEALTH_TIMEOUT_MS)) {
            resetProbeLocked(signal, output);
        }
    }

    private void resetProbeLocked(long signal, long output) {
        probeSignalBaseline = signal;
        probeOutputBaseline = output;
        probeStartedAt = 0;
        probeOutputEnabled = false;
        probeVerified = false;
    }

    private static boolean isRecent(long now, long timestamp, long maxAge) {
        return timestamp > 0 && now >= timestamp && now - timestamp <= maxAge;
    }

    private static boolean hasStartedPlayer(SystemDumps.Snapshot snapshot, SystemDumps.Session session) {
        for (SystemDumps.Player player : snapshot.players) {
            if (player.session == session.id && player.uid == session.uid
                    && "started".equalsIgnoreCase(player.state) && SystemDumps.capturable(player.usage)) return true;
        }
        return false;
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
        String appLabel = pkg;
        try {
            ApplicationInfo info = packages.getApplicationInfo(pkg, 0);
            appLabel = packages.getApplicationLabel(info).toString();
        } catch (PackageManager.NameNotFoundException ignored) {
            // Not visible to this app; show the package name.
        }
        labels.put(pkg, appLabel);
        return appLabel;
    }

    private void emergencyRelease(String packageName) {
        synchronized (muteLock) {
            TreeSet<String> unmuted = new TreeSet<>();
            unmuted.add(label(packageName));
            for (SessionMute mute : mutes.values()) unmuted.add(label(mute.packageName));
            releaseAllLocked();
            probeUid = -1;
            resetProbeLocked(lastSignal.getAsLong(), lastOutput.getAsLong());
            outputGate.setEnabled(false);
            SystemStatus.processed = new String[0];
            SystemStatus.unmuted = unmuted.toArray(new String[0]);
            SystemStatus.message = context.getString(R.string.status_checking_capture);
        }
    }

    private void releaseAll() {
        synchronized (muteLock) {
            releaseAllLocked();
            probeUid = -1;
            resetProbeLocked(lastSignal.getAsLong(), lastOutput.getAsLong());
            outputGate.setEnabled(false);
        }
    }

    private void releaseAllLocked() {
        for (SessionMute mute : mutes.values()) mute.release();
        mutes.clear();
    }
}
