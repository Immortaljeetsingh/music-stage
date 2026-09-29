package io.github.immortaljeetsingh.musicstage.engine;

/**
 * Stereo-linked emergency compressor for the spatial modes, using the web graph's DynamicsCompressorNode settings
 * (threshold -1.5 dB, hard knee, ratio 20, attack 3 ms, release 120 ms) and the browser's automatic makeup gain
 * (inverse of the curve at 0 dBFS raised to 0.6). Clarity mode never uses it.
 */
final class Compressor {
    private static final double THRESHOLD_DB = -1.5, RATIO = 20;
    private final double attack, release, makeup;
    private double reductionDb;

    Compressor(int sampleRate) {
        attack = Math.exp(-1.0 / (0.003 * sampleRate));
        release = Math.exp(-1.0 / (0.12 * sampleRate));
        double curveAtFullScale = THRESHOLD_DB + (0 - THRESHOLD_DB) / RATIO;
        makeup = Math.pow(Math.pow(10, -curveAtFullScale / 20), 0.6);
    }

    void process(float[] left, float[] right, int frames) {
        for (int i = 0; i < frames; i++) {
            double peak = Math.max(Math.abs(left[i]), Math.abs(right[i]));
            double levelDb = peak > 1e-9 ? 20 * Math.log10(peak) : -180;
            double target = levelDb > THRESHOLD_DB ? (THRESHOLD_DB + (levelDb - THRESHOLD_DB) / RATIO) - levelDb : 0;
            double coef = target < reductionDb ? attack : release;
            reductionDb = coef * reductionDb + (1 - coef) * target;
            double gain = makeup * (reductionDb < -1e-6 ? Math.pow(10, reductionDb / 20) : 1);
            left[i] = (float) (left[i] * gain);
            right[i] = (float) (right[i] * gain);
        }
    }
}
