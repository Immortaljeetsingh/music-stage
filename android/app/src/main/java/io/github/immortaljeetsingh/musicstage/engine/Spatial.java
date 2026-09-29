package io.github.immortaljeetsingh.musicstage.engine;

/** Geometry and panning laws shared with the Web Audio engine (StereoPannerNode and 'equalpower' PannerNode). */
final class Spatial {
    private Spatial() {
    }

    /** Distance loudness curve from the web engine: loud up close, clearly quieter far away. */
    static double proxGain(double distance) {
        return Math.min(3.5, 1.4 / (1 + 0.45 * Math.max(0, distance - 0.4)));
    }

    /** StereoPannerNode law for a mono input: gains written to out[0] (left) and out[1] (right). */
    static void monoPan(double pan, double[] out) {
        double p = Math.max(-1, Math.min(1, pan)), x = (p + 1) / 2;
        out[0] = Math.cos(x * Math.PI / 2);
        out[1] = Math.sin(x * Math.PI / 2);
    }

    /**
     * PannerNode azimuth in degrees (0 ahead, -90 left, +90 right) following the Web Audio specification's
     * source/listener projection. Positions use Web Audio axes: x right, y up, z towards the listener's back.
     */
    static double azimuth(double sx, double sy, double sz, double lx, double ly, double lz,
                          double fx, double fy, double fz, double ux, double uy, double uz) {
        double dx = sx - lx, dy = sy - ly, dz = sz - lz, length = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (length < 1e-12) return 0;
        dx /= length;
        dy /= length;
        dz /= length;
        double fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
        if (fl < 1e-12) return 0;
        double nfx = fx / fl, nfy = fy / fl, nfz = fz / fl;
        double rx = nfy * uz - nfz * uy, ry = nfz * ux - nfx * uz, rz = nfx * uy - nfy * ux;
        double rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
        if (rl < 1e-12) return 0;
        rx /= rl;
        ry /= rl;
        rz /= rl;
        double upx = ry * nfz - rz * nfy, upy = rz * nfx - rx * nfz, upz = rx * nfy - ry * nfx;
        double projection = dx * upx + dy * upy + dz * upz;
        double px = dx - projection * upx, py = dy - projection * upy, pz = dz - projection * upz;
        double pl = Math.sqrt(px * px + py * py + pz * pz);
        if (pl < 1e-12) return 0;
        px /= pl;
        py /= pl;
        pz /= pl;
        double az = Math.toDegrees(Math.acos(Math.max(-1, Math.min(1, px * rx + py * ry + pz * rz))));
        if (px * nfx + py * nfy + pz * nfz < 0) az = 360 - az;
        return az >= 0 && az <= 270 ? 90 - az : 450 - az;
    }

    /** 'equalpower' panning of a mono source at the given azimuth. */
    static void equalPower(double azimuthDegrees, double[] out) {
        double a = Math.max(-180, Math.min(180, azimuthDegrees));
        if (a < -90) a = -180 - a;
        else if (a > 90) a = 180 - a;
        double x = (a + 90) / 180;
        out[0] = Math.cos(x * Math.PI / 2);
        out[1] = Math.sin(x * Math.PI / 2);
    }
}
