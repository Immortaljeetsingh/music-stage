package io.github.immortaljeetsingh.musicstage;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioPlaybackCaptureConfiguration;
import android.media.AudioRecord;
import android.media.AudioTrack;
import android.media.projection.MediaProjection;
import android.os.Process;
import io.github.immortaljeetsingh.musicstage.engine.StageConfig;
import io.github.immortaljeetsingh.musicstage.engine.StageEngine;

/**
 * Capture, render and play-back loop: other apps' media/game audio arrives through AudioPlaybackCapture, runs through
 * the Music Stage engine and leaves through a low-latency AudioTrack that is itself excluded from capture.
 */
final class AudioLoop extends Thread {
    interface Listener {
        void onFailure(String message);
    }

    static final int SAMPLE_RATE = 48000;
    private static final int BLOCK = 480;
    private static final int PAUSE_AFTER_SILENT_BLOCKS = 300; // 3 s of silence stops the output stream to save power

    final StageEngine engine;
    private final MediaProjection projection;
    private final Listener listener;
    private volatile boolean running = true;
    private AudioRecord record;
    private AudioTrack track;

    AudioLoop(MediaProjection projection, StageConfig config, Listener listener) {
        super("MusicStageAudio");
        this.projection = projection;
        this.listener = listener;
        engine = new StageEngine(SAMPLE_RATE, config);
    }

    void shutdown() {
        running = false;
        synchronized (this) {
            AudioRecord r = record;
            if (r != null) {
                try {
                    r.stop();
                } catch (IllegalStateException ignored) {
                    // Not recording yet.
                }
            }
        }
        interrupt();
    }

    @Override
    public void run() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO);
        try {
            AudioPlaybackCaptureConfiguration capture = new AudioPlaybackCaptureConfiguration.Builder(projection)
                    .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                    .addMatchingUsage(AudioAttributes.USAGE_GAME)
                    .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                    .excludeUid(Process.myUid())
                    .build();
            AudioFormat inFormat = new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                    .setSampleRate(SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_IN_STEREO).build();
            int minIn = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_FLOAT);
            AudioRecord newRecord = new AudioRecord.Builder().setAudioFormat(inFormat)
                    .setBufferSizeInBytes(Math.max(minIn, BLOCK * 8) * 2)
                    .setAudioPlaybackCaptureConfig(capture).build();
            synchronized (this) {
                record = newRecord;
            }
            if (newRecord.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("Audio capture could not start.");
            AudioAttributes attributes = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .setAllowedCapturePolicy(AudioAttributes.ALLOW_CAPTURE_BY_NONE).build();
            AudioFormat outFormat = new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
                    .setSampleRate(SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).build();
            int minOut = AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_FLOAT);
            track = new AudioTrack.Builder().setAudioAttributes(attributes).setAudioFormat(outFormat)
                    .setBufferSizeInBytes(Math.max(minOut, BLOCK * 8 * 2))
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY).build();
            if (track.getState() != AudioTrack.STATE_INITIALIZED) throw new IllegalStateException("Audio output could not start.");
            float[] in = new float[BLOCK * 2], out = new float[BLOCK * 2];
            newRecord.startRecording();
            track.play();
            SystemStatus.latencyMs = (int) Math.round((BLOCK + track.getBufferSizeInFrames()) * 1000.0 / SAMPLE_RATE);
            int silentBlocks = 0;
            boolean paused = false;
            while (running) {
                int read = newRecord.read(in, 0, in.length, AudioRecord.READ_BLOCKING);
                if (!running) break;
                if (read < 0) throw new IllegalStateException("Audio capture stopped (" + read + ").");
                if (read < 2) continue;
                int frames = read / 2;
                engine.process(in, out, frames);
                silentBlocks = isSilent(in, frames * 2) ? silentBlocks + 1 : 0;
                if (silentBlocks > PAUSE_AFTER_SILENT_BLOCKS && isSilent(out, frames * 2)) {
                    if (!paused) {
                        track.pause();
                        track.flush();
                        paused = true;
                    }
                    continue;
                }
                if (paused) {
                    track.play();
                    paused = false;
                }
                track.write(out, 0, frames * 2, AudioTrack.WRITE_BLOCKING);
                SystemStatus.underruns = track.getUnderrunCount();
            }
        } catch (RuntimeException e) {
            if (running) listener.onFailure(e.getMessage() == null ? e.toString() : e.getMessage());
        } finally {
            synchronized (this) {
                if (record != null) {
                    try {
                        record.release();
                    } catch (RuntimeException ignored) {
                        // Released twice.
                    }
                    record = null;
                }
            }
            if (track != null) {
                try {
                    track.release();
                } catch (RuntimeException ignored) {
                    // Released twice.
                }
            }
        }
    }

    private static boolean isSilent(float[] samples, int count) {
        for (int i = 0; i < count; i++) if (samples[i] > 1e-7f || samples[i] < -1e-7f) return false;
        return true;
    }
}
