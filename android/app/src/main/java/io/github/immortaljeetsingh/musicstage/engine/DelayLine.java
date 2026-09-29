package io.github.immortaljeetsingh.musicstage.engine;

/** Fractional delay line with linear interpolation; the delay may change every sample (like an a-rate DelayNode). */
final class DelayLine {
    private final float[] buffer;
    private final int mask;
    private final double maxDelay;
    private int write;

    DelayLine(int maxDelaySamples) {
        int size = 16;
        while (size < maxDelaySamples + 4) size <<= 1;
        buffer = new float[size];
        mask = size - 1;
        maxDelay = size - 3;
    }

    float process(float input, double delaySamples) {
        buffer[write] = input;
        double d = delaySamples < 0 ? 0 : (delaySamples > maxDelay ? maxDelay : delaySamples);
        double position = write - d;
        int index = (int) Math.floor(position);
        float frac = (float) (position - index);
        float a = buffer[index & mask], b = buffer[(index + 1) & mask];
        write = (write + 1) & mask;
        return a + (b - a) * frac;
    }
}
