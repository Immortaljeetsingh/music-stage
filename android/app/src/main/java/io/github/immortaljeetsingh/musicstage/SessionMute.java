package io.github.immortaljeetsingh.musicstage;

import android.media.audiofx.AudioEffect;
import android.media.audiofx.DynamicsProcessing;
import android.os.SystemClock;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.LongSupplier;

/**
 * Silences one verified session. A dedicated safety scheduler restores direct output if processed writes stop for
 * three seconds or the authoritative session monitor stops renewing this mute's short lease.
 */
final class SessionMute {
    private static final float SILENCE_DB = -200f;
    private static final long OUTPUT_TIMEOUT_MS = 3000;
    private static final long LEASE_TIMEOUT_MS = 4000;
    private static final long CHECK_MS = 100;

    final int session;
    final int uid;
    final String packageName;
    private final DynamicsProcessing effect;
    private final LongSupplier lastOutput;
    private final Runnable onFailOpen;
    private final AtomicBoolean released = new AtomicBoolean();
    private volatile boolean lost;
    private volatile long leaseDeadline;
    private volatile ScheduledFuture<?> watchdog;

    SessionMute(int session, int uid, String packageName, ScheduledExecutorService safety,
                LongSupplier lastOutput, Runnable onFailOpen) {
        this.session = session;
        this.uid = uid;
        this.packageName = packageName;
        this.lastOutput = lastOutput;
        this.onFailOpen = onFailOpen;
        long now = SystemClock.elapsedRealtime();
        leaseDeadline = now + LEASE_TIMEOUT_MS;
        effect = new DynamicsProcessing(Integer.MAX_VALUE, session, null);
        effect.setEnableStatusListener((fx, enabled) -> {
            if (!enabled && !released.get()) silence();
        });
        effect.setControlStatusListener((fx, granted) -> {
            if (granted && !released.get()) silence();
            else if (!granted && !released.get()) failOpen();
        });
        silence();
        if (!lost) watchdog = safety.scheduleAtFixedRate(this::checkHealth, CHECK_MS, CHECK_MS, TimeUnit.MILLISECONDS);
    }

    private void silence() {
        try {
            effect.setInputGainAllChannelsTo(SILENCE_DB);
            if (effect.setEnabled(true) != AudioEffect.SUCCESS || !effect.hasControl()) failOpen();
        } catch (RuntimeException e) {
            failOpen();
        }
    }

    void renewLease(long now) {
        if (!released.get()) leaseDeadline = now + LEASE_TIMEOUT_MS;
    }

    private void checkHealth() {
        if (released.get()) return;
        long output = lastOutput.getAsLong();
        long now = SystemClock.elapsedRealtime();
        boolean outputExpired = output <= 0 || (now >= output && now - output > OUTPUT_TIMEOUT_MS);
        if (outputExpired || now > leaseDeadline) failOpen();
    }

    private void failOpen() {
        lost = true;
        if (releaseEffect()) onFailOpen.run();
    }

    boolean isLost() {
        return lost;
    }

    void release() {
        releaseEffect();
    }

    private boolean releaseEffect() {
        if (!released.compareAndSet(false, true)) return false;
        ScheduledFuture<?> task = watchdog;
        if (task != null) task.cancel(false);
        try {
            effect.release();
        } catch (RuntimeException ignored) {
            // Already released by the audio server.
        }
        return true;
    }
}
