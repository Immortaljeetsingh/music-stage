package io.github.immortaljeetsingh.musicstage.engine;

/**
 * Transposed direct-form II biquad using the Web Audio BiquadFilterNode coefficient definitions, so the port
 * matches the browser engine: low/high-pass Q is in dB, band-pass and peaking Q are linear, shelves use S = 1.
 * A 0 dB peaking or shelf section is an exact unity bypass.
 */
final class Biquad {
    static final int PEAKING = 0, LOWPASS = 1, HIGHPASS = 2, BANDPASS = 3, LOWSHELF = 4, HIGHSHELF = 5;

    private double b0 = 1, b1, b2, a1, a2, z1, z2;
    private boolean unity = true;
    private int type = PEAKING;
    private double freq = 1000, q = 0.707, gain;

    void setUnity() {
        type = PEAKING;
        freq = 1000;
        q = 0.707;
        gain = 0;
        unity = true;
    }

    boolean isUnity() {
        return unity;
    }

    void configure(int newType, double frequency, double newQ, double gainDb, double sampleRate) {
        double f = Math.max(10.0, Math.min(frequency, sampleRate * 0.49));
        if (newType == type && f == freq && newQ == q && gainDb == gain) return;
        boolean wasUnity = unity;
        type = newType;
        freq = f;
        q = newQ;
        gain = gainDb;
        if ((newType == PEAKING || newType == LOWSHELF || newType == HIGHSHELF) && gainDb == 0) {
            unity = true;
            return;
        }
        double w0 = 2 * Math.PI * f / sampleRate, cos = Math.cos(w0), sin = Math.sin(w0);
        double a = Math.pow(10, gainDb / 40);
        double nb0, nb1, nb2, na0, na1, na2;
        switch (newType) {
            case LOWPASS: {
                double alpha = sin / (2 * Math.pow(10, newQ / 20));
                nb0 = (1 - cos) / 2;
                nb1 = 1 - cos;
                nb2 = nb0;
                na0 = 1 + alpha;
                na1 = -2 * cos;
                na2 = 1 - alpha;
                break;
            }
            case HIGHPASS: {
                double alpha = sin / (2 * Math.pow(10, newQ / 20));
                nb0 = (1 + cos) / 2;
                nb1 = -(1 + cos);
                nb2 = nb0;
                na0 = 1 + alpha;
                na1 = -2 * cos;
                na2 = 1 - alpha;
                break;
            }
            case BANDPASS: {
                double alpha = sin / (2 * newQ);
                nb0 = alpha;
                nb1 = 0;
                nb2 = -alpha;
                na0 = 1 + alpha;
                na1 = -2 * cos;
                na2 = 1 - alpha;
                break;
            }
            case LOWSHELF: {
                double k = 2 * Math.sqrt(a) * (sin / 2 * Math.sqrt(2));
                nb0 = a * ((a + 1) - (a - 1) * cos + k);
                nb1 = 2 * a * ((a - 1) - (a + 1) * cos);
                nb2 = a * ((a + 1) - (a - 1) * cos - k);
                na0 = (a + 1) + (a - 1) * cos + k;
                na1 = -2 * ((a - 1) + (a + 1) * cos);
                na2 = (a + 1) + (a - 1) * cos - k;
                break;
            }
            case HIGHSHELF: {
                double k = 2 * Math.sqrt(a) * (sin / 2 * Math.sqrt(2));
                nb0 = a * ((a + 1) + (a - 1) * cos + k);
                nb1 = -2 * a * ((a - 1) + (a + 1) * cos);
                nb2 = a * ((a + 1) + (a - 1) * cos - k);
                na0 = (a + 1) - (a - 1) * cos + k;
                na1 = 2 * ((a - 1) - (a + 1) * cos);
                na2 = (a + 1) - (a - 1) * cos - k;
                break;
            }
            default: {
                double alpha = sin / (2 * newQ);
                nb0 = 1 + alpha * a;
                nb1 = -2 * cos;
                nb2 = 1 - alpha * a;
                na0 = 1 + alpha / a;
                na1 = -2 * cos;
                na2 = 1 - alpha / a;
            }
        }
        b0 = nb0 / na0;
        b1 = nb1 / na0;
        b2 = nb2 / na0;
        a1 = na1 / na0;
        a2 = na2 / na0;
        if (wasUnity) {
            z1 = 0;
            z2 = 0;
        }
        unity = false;
    }

    double process(double x) {
        if (unity) return x;
        double y = b0 * x + z1;
        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;
        if (z1 > -1e-30 && z1 < 1e-30) z1 = 0; // keep silent tails out of the slow subnormal range
        if (z2 > -1e-30 && z2 < 1e-30) z2 = 0;
        return y;
    }

    /** Magnitude response |H(e^jw)| at {@code frequency}; used by the fidelity tests. */
    double magnitude(double frequency, double sampleRate) {
        if (unity) return 1;
        double w = 2 * Math.PI * frequency / sampleRate, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
        double nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2);
        double dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
        return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
    }
}
