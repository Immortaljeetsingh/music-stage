package io.github.immortaljeetsingh.musicstage;

import android.media.audiofx.DynamicsProcessing;

/**
 * Silences an app's direct output while its audio is being captured, so only the processed copy is heard.
 * Uses the public DynamicsProcessing effect with maximum priority and its input gain at -200 dB; the capture tap
 * receives the app's audio before this output effect. Releasing it restores the app's own output immediately.
 */
final class SessionMute {
    private static final float SILENCE_DB = -200f;
    final int session;
    private final DynamicsProcessing effect;
    private volatile boolean lost;

    SessionMute(int session) {
        this.session = session;
        effect = new DynamicsProcessing(Integer.MAX_VALUE, session, null);
        effect.setEnableStatusListener((fx, enabled) -> {
            if (!enabled) silence();
        });
        effect.setControlStatusListener((fx, granted) -> {
            if (granted) silence();
            else lost = true;
        });
        silence();
    }

    private void silence() {
        try {
            effect.setInputGainAllChannelsTo(SILENCE_DB);
            effect.setEnabled(true);
        } catch (RuntimeException e) {
            lost = true;
        }
    }

    /** True when another app took control of the session's effects; the owner re-creates the mute. */
    boolean isLost() {
        return lost;
    }

    void release() {
        try {
            effect.release();
        } catch (RuntimeException ignored) {
            // Already released by the audio server.
        }
    }
}
