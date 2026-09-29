package io.github.immortaljeetsingh.musicstage.engine;

/** In-place iterative radix-2 complex FFT with precomputed twiddles and bit reversal. */
final class FFT {
    final int size;
    private final int[] reverse;
    private final float[] cos, sin;

    FFT(int size) {
        if (size < 2 || Integer.bitCount(size) != 1) throw new IllegalArgumentException("FFT size must be a power of two");
        this.size = size;
        int bits = Integer.numberOfTrailingZeros(size);
        reverse = new int[size];
        for (int i = 0; i < size; i++) reverse[i] = Integer.reverse(i) >>> (32 - bits);
        cos = new float[size / 2];
        sin = new float[size / 2];
        for (int i = 0; i < size / 2; i++) {
            cos[i] = (float) Math.cos(2 * Math.PI * i / size);
            sin[i] = (float) Math.sin(2 * Math.PI * i / size);
        }
    }

    /** Forward transform uses e^(-j2πkn/N); the inverse is scaled by 1/N. */
    void transform(float[] re, float[] im, boolean inverse) {
        int n = size;
        for (int i = 0; i < n; i++) {
            int j = reverse[i];
            if (j > i) {
                float tr = re[i];
                re[i] = re[j];
                re[j] = tr;
                float ti = im[i];
                im[i] = im[j];
                im[j] = ti;
            }
        }
        for (int span = 2; span <= n; span <<= 1) {
            int half = span >> 1, step = n / span;
            for (int start = 0; start < n; start += span) {
                for (int k = 0; k < half; k++) {
                    float wr = cos[k * step], wi = inverse ? sin[k * step] : -sin[k * step];
                    int a = start + k, b = a + half;
                    float xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
                    re[b] = re[a] - xr;
                    im[b] = im[a] - xi;
                    re[a] += xr;
                    im[a] += xi;
                }
            }
        }
        if (inverse) {
            float scale = 1f / n;
            for (int i = 0; i < n; i++) {
                re[i] *= scale;
                im[i] *= scale;
            }
        }
    }
}
