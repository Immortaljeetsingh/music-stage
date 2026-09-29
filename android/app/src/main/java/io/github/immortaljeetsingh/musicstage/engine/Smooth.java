package io.github.immortaljeetsingh.musicstage.engine;

/** One-pole parameter glide equivalent to AudioParam.setTargetAtTime(target, now, tau). */
final class Smooth {
    double cur, tgt;
    private final double coef, keep;

    Smooth(double tau, int sampleRate) {
        coef = tau <= 0 ? 1 : 1 - Math.exp(-1.0 / (tau * sampleRate));
        keep = 1 - coef;
    }

    double next() {
        double d = tgt - cur;
        if (d > -1e-12 && d < 1e-12) {
            cur = tgt;
            return cur;
        }
        cur += d * coef;
        return cur;
    }

    /** Advances {@code samples} steps at once for parameters that are applied once per block. */
    double advance(int samples) {
        cur = tgt + (cur - tgt) * Math.pow(keep, samples);
        if (Math.abs(tgt - cur) < 1e-12) cur = tgt;
        return cur;
    }

    void snap() {
        cur = tgt;
    }
}
