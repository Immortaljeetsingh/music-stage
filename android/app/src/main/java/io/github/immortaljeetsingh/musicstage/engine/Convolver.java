package io.github.immortaljeetsingh.musicstage.engine;

import java.util.Arrays;

/**
 * Mono uniformly-partitioned overlap-save FFT convolution for the late-reverb tail. Latency is one partition,
 * which acts as a short pre-delay on a tail that already arrives after the direct sound.
 */
final class Convolver {
    /** Immutable impulse-response spectra, shareable between graphs. */
    static final class Kernel {
        final int partition, fftSize, partitions;
        final FFT fft;
        final float[][] re, im;

        Kernel(float[] impulse, int partition) {
            this.partition = partition;
            fftSize = partition * 2;
            fft = new FFT(fftSize);
            partitions = Math.max(1, (impulse.length + partition - 1) / partition);
            re = new float[partitions][partition + 1];
            im = new float[partitions][partition + 1];
            float[] tr = new float[fftSize], ti = new float[fftSize];
            for (int k = 0; k < partitions; k++) {
                Arrays.fill(tr, 0f);
                Arrays.fill(ti, 0f);
                int start = k * partition, count = Math.max(0, Math.min(partition, impulse.length - start));
                System.arraycopy(impulse, start, tr, 0, count);
                fft.transform(tr, ti, false);
                System.arraycopy(tr, 0, re[k], 0, partition + 1);
                System.arraycopy(ti, 0, im[k], 0, partition + 1);
            }
        }
    }

    private final Kernel kernel;
    private final int p, n, parts;
    private final float[] previous, current, output, tr, ti, accR, accI;
    private final float[][] xr, xi;
    private int fill, slot;

    Convolver(Kernel kernel) {
        this.kernel = kernel;
        p = kernel.partition;
        n = kernel.fftSize;
        parts = kernel.partitions;
        previous = new float[p];
        current = new float[p];
        output = new float[p];
        tr = new float[n];
        ti = new float[n];
        accR = new float[p + 1];
        accI = new float[p + 1];
        xr = new float[parts][p + 1];
        xi = new float[parts][p + 1];
    }

    void process(float[] in, float[] out, int frames) {
        for (int i = 0; i < frames; i++) {
            current[fill] = in[i];
            out[i] = output[fill];
            if (++fill == p) {
                runPartition();
                fill = 0;
            }
        }
    }

    private void runPartition() {
        System.arraycopy(previous, 0, tr, 0, p);
        System.arraycopy(current, 0, tr, p, p);
        Arrays.fill(ti, 0f);
        kernel.fft.transform(tr, ti, false);
        System.arraycopy(tr, 0, xr[slot], 0, p + 1);
        System.arraycopy(ti, 0, xi[slot], 0, p + 1);
        Arrays.fill(accR, 0f);
        Arrays.fill(accI, 0f);
        for (int k = 0; k < parts; k++) {
            int s = slot - k;
            if (s < 0) s += parts;
            float[] ar = xr[s], ai = xi[s], hr = kernel.re[k], hi = kernel.im[k];
            for (int b = 0; b <= p; b++) {
                float x = ar[b], y = ai[b], u = hr[b], v = hi[b];
                accR[b] += x * u - y * v;
                accI[b] += x * v + y * u;
            }
        }
        for (int b = 0; b <= p; b++) {
            tr[b] = accR[b];
            ti[b] = accI[b];
        }
        for (int b = 1; b < p; b++) {
            tr[n - b] = accR[b];
            ti[n - b] = -accI[b];
        }
        kernel.fft.transform(tr, ti, true);
        System.arraycopy(tr, p, output, 0, p);
        System.arraycopy(current, 0, previous, 0, p);
        slot = slot + 1 == parts ? 0 : slot + 1;
    }
}
