package io.github.immortaljeetsingh.musicstage.engine;

/** Measurement-based headphone correction presets copied from the web engine (AutoEq: crinacle 711 + Rtings B&K5128). */
final class HeadphoneProfiles {
    static final class Profile {
        final double preampDb;
        /** Each filter: {frequency Hz, Biquad type, gain dB, Q}. */
        final double[][] filters;

        Profile(double preampDb, double[][] filters) {
            this.preampDb = preampDb;
            this.filters = filters;
        }
    }

    private static final int LS = Biquad.LOWSHELF, PK = Biquad.PEAKING, HS = Biquad.HIGHSHELF;

    private HeadphoneProfiles() {
    }

    /** Returns null for "no correction", including the unverified AirPods Pro 3 bypass entry. */
    static Profile get(String name) {
        if (name == null) return null;
        switch (name) {
            case "AirPods Pro 2 (ANC)":
                return new Profile(-3.3, new double[][]{{105, LS, 0.5, 0.7}, {427, PK, -2.6, 0.8}, {3647, PK, 2.3, 0.77}, {9516, PK, 2.8, 3.44}, {76, PK, 1.9, 1.34}, {10000, HS, -1.8, 0.7}, {5938, PK, 2.6, 1.27}, {6486, PK, -6.3, 5.92}, {1172, PK, 1.1, 5.05}, {3326, PK, -1.9, 4.4}});
            case "AirPods 4":
                return new Profile(-6.4, new double[][]{{105, LS, 11.4, 0.7}, {4622, PK, 6, 1.39}, {49, PK, -11.7, 0.39}, {1277, PK, -2.6, 0.86}, {3036, PK, 4.1, 2.43}, {10000, HS, -1.9, 0.7}, {354, PK, -1.4, 1.5}, {176, PK, 1.5, 2.04}, {618, PK, 1, 2.35}, {106, PK, -0.9, 2.47}});
            case "AirPods 4 (ANC)":
                return new Profile(-6.2, new double[][]{{105, LS, 12.7, 0.7}, {49, PK, -13.2, 0.44}, {3573, PK, 6, 1.4}, {1318, PK, -2.8, 1.16}, {5138, PK, 3.2, 2.82}, {10000, HS, -2, 0.7}, {166, PK, 1.2, 3.49}, {100, PK, -0.7, 2.5}, {438, PK, -0.8, 2.38}, {654, PK, 0.6, 2.93}});
            case "EarPods":
                return new Profile(-6.2, new double[][]{{105, LS, 6.2, 0.7}, {6106, PK, -6.5, 1.79}, {4238, PK, 5.1, 1.8}, {912, PK, 2.5, 1.87}, {1739, PK, -2.1, 1.73}, {10000, HS, -0.8, 0.7}, {147, PK, -1.1, 1.2}, {78, PK, 1.7, 2.98}, {108, PK, -0.4, 2.22}, {2657, PK, -0.4, 5.13}});
            default:
                return null;
        }
    }
}
