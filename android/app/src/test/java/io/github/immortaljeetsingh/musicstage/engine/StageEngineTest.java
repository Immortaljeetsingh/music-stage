package io.github.immortaljeetsingh.musicstage.engine;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The Java engine must render like the browser engine. Expected values come from the web suite
 * (test-fidelity.cjs, test.cjs, test-quality.cjs) measured on Chromium's Web Audio implementation.
 */
public class StageEngineTest {
    private static final int SR = 48000;
    private static final int BLOCK = 480;

    private static StageConfig.Builder fidelityStage(boolean near, double speakerVolume, double masterVolume) {
        StageConfig.Builder b = new StageConfig.Builder();
        b.roomW = 10;
        b.roomL = 10;
        b.roomH = 3;
        b.listenerX = 5;
        b.listenerY = 5;
        double y = near ? 4.9 : 2;
        b.speakers = new StageConfig.Speaker[]{
                new StageConfig.Speaker(near ? 4.9 : 2, y, 1.6, speakerVolume, false, false, "L", "Full"),
                new StageConfig.Speaker(near ? 5.1 : 8, y, 1.6, speakerVolume, false, false, "R", "Full")};
        b.mvol = masterVolume;
        return b;
    }

    private interface Signal {
        double left(int i);

        double right(int i);
    }

    private static Signal sine(double ampL, double ampR, double frequency) {
        return new Signal() {
            public double left(int i) {
                return ampL * Math.sin(2 * Math.PI * frequency * i / SR);
            }

            public double right(int i) {
                return ampR * Math.sin(2 * Math.PI * frequency * i / SR);
            }
        };
    }

    /** Streams {@code frames} of the signal through a fresh engine in capture-sized blocks. */
    private static float[] render(StageConfig config, Signal signal, int frames) {
        StageEngine engine = new StageEngine(SR, config);
        float[] out = new float[frames * 2], in = new float[BLOCK * 2], block = new float[BLOCK * 2];
        for (int offset = 0; offset < frames; offset += BLOCK) {
            int n = Math.min(BLOCK, frames - offset);
            for (int i = 0; i < n; i++) {
                in[2 * i] = (float) signal.left(offset + i);
                in[2 * i + 1] = (float) signal.right(offset + i);
            }
            engine.process(in, block, n);
            System.arraycopy(block, 0, out, offset * 2, n * 2);
        }
        return out;
    }

    private static double peak(float[] out, int channel, int from) {
        double p = 0;
        for (int i = from; i < out.length / 2; i++) p = Math.max(p, Math.abs(out[2 * i + channel]));
        return p;
    }

    private static double rms(float[] out, int channel, int from) {
        double sum = 0;
        int count = 0;
        for (int i = from; i < out.length / 2; i++) {
            sum += out[2 * i + channel] * out[2 * i + channel];
            count++;
        }
        return Math.sqrt(sum / Math.max(1, count));
    }

    @Test
    public void clarityMatchesTheWebEngineGainAndIsolation() {
        float[] out = render(fidelityStage(false, 1, 0.9).build(), sine(0.2, 0, 1000), SR);
        assertEquals("web normalPeak", 0.082293801, peak(out, 0, SR / 2), 2e-4);
        assertTrue("left-only input must not reach the right ear", peak(out, 1, 0) < 1e-7);
    }

    @Test
    public void clarityIsSampleLinear() {
        Signal signal = sine(0.2, 0.15, 997);
        float[] out = render(fidelityStage(false, 1, 0.9).build(), signal, SR / 4);
        double expected = 0.082293801 / 0.2;
        for (int i = 100; i < SR / 4; i += 37) {
            double in = signal.left(i);
            if (Math.abs(in) > 0.02) assertEquals(expected, out[2 * i] / in, 1e-5);
        }
    }

    @Test
    public void stereoProgramMatchesTheWebPeak() {
        float[] out = render(fidelityStage(false, 1, 0.9).build(), sine(0.7, 0.7, 997), SR);
        assertEquals("web stereoPeak", 0.28802827, Math.max(peak(out, 0, 0), peak(out, 1, 0)), 3e-4);
    }

    @Test
    public void extremeGainStaysUnderTheCeiling() {
        float[] out = render(fidelityStage(true, 4, 2.5).build(), sine(1, 1, 1000), SR);
        double p = Math.max(peak(out, 0, 0), peak(out, 1, 0));
        assertTrue("never above -1 dBFS", p <= StageEngine.OUTPUT_CEILING + 1e-6);
        assertEquals("web hotPeak (automatic headroom, no clamping)", 0.664387047, p, 0.005);
    }

    @Test
    public void lowAndHighPassSectionsAreButterworth() {
        double[][] cases = {{Biquad.LOWPASS, 120}, {Biquad.LOWPASS, 300}, {Biquad.LOWPASS, 1800}, {Biquad.LOWPASS, 12000},
                {Biquad.HIGHPASS, 2500}, {Biquad.HIGHPASS, 5000}};
        for (double[] c : cases) {
            Biquad f = new Biquad();
            f.configure((int) c[0], c[1], StageEngine.BUTTERWORTH_Q_DB, 0, SR);
            double max = 0;
            for (int i = 0; i < 2048; i++) max = Math.max(max, f.magnitude(10 * Math.pow(2000, i / 2047.0), SR));
            assertTrue("resonance at " + c[1] + " Hz: " + max, max <= 1.001);
            assertEquals("-3 dB at the corner", Math.sqrt(0.5), f.magnitude(c[1], SR), 0.01);
        }
    }

    @Test
    public void spatialModesStayCenteredWithReflections() {
        for (String band : new String[]{"Full", "Bass", "Tweeter"}) {
            for (boolean precise : new boolean[]{false, true}) {
                StageConfig.Builder b = new StageConfig.Builder();
                b.roomW = 6;
                b.roomL = 8;
                b.roomH = 3;
                b.listenerX = 3;
                b.listenerY = 4;
                b.speakers = new StageConfig.Speaker[]{
                        new StageConfig.Speaker(1, 1, 1.6, 1, false, false, "L", band),
                        new StageConfig.Speaker(5, 1, 1.6, 1, false, false, "R", band)};
                b.renderMode = precise ? "immersive" : "room";
                b.hq = precise;
                b.walls = true;
                b.roomAmt = 0.4;
                double frequency = "Tweeter".equals(band) ? 6000 : 80;
                float[] out = render(b.build(), sine(0.02, 0.02, frequency), SR);
                double l = rms(out, 0, SR / 2), r = rms(out, 1, SR / 2);
                assertTrue(band + " precise=" + precise + " is silent", l > 1e-5);
                assertEquals(band + " precise=" + precise + " imbalance (dB)", 0, 20 * Math.log10(l / r), 0.1);
            }
        }
    }

    @Test
    public void programLevelsMatchTheWebRigs() {
        Signal program = new Signal() {
            public double left(int i) {
                double t = i / (double) SR;
                return 0.32 * (Math.sin(2 * Math.PI * 110 * t) + 0.5 * Math.sin(2 * Math.PI * 440 * t) + 0.25 * Math.sin(2 * Math.PI * 3000 * t)) / 1.75
                        + 0.08 * Math.sin(2 * Math.PI * 55 * t) * Math.exp(-((t % 0.5) * 6));
            }

            public double right(int i) {
                return left(i);
            }
        };
        float[] two = render(new StageConfig.Builder().build(), program, 2 * SR);
        assertEquals("web two-box Clarity program peak", 0.153, Math.max(peak(two, 0, 0), peak(two, 1, 0)), 0.002);

        StageConfig.Builder nine = new StageConfig.Builder();
        double w = 10, l = 10, h = Math.min(2.6, 10 - 0.3);
        nine.speakers = new StageConfig.Speaker[]{
                new StageConfig.Speaker(0.5, 0.5, 1.6, 1, false, false, "L", "Full"),
                new StageConfig.Speaker(w - 0.5, 0.5, 1.6, 1, false, false, "R", "Full"),
                new StageConfig.Speaker(0.5, l - 0.5, 1.6, 0.7, false, false, "L", "Vocal"),
                new StageConfig.Speaker(w - 0.5, l - 0.5, 1.6, 0.7, false, false, "R", "Vocal"),
                new StageConfig.Speaker(0.5, 0.5, h, 0.6, false, false, "L", "Tweeter"),
                new StageConfig.Speaker(w - 0.5, 0.5, h, 0.6, false, false, "R", "Tweeter"),
                new StageConfig.Speaker(0.5, l - 0.5, h, 0.6, false, false, "L", "Tweeter"),
                new StageConfig.Speaker(w - 0.5, l - 0.5, h, 0.6, false, false, "R", "Tweeter"),
                new StageConfig.Speaker(w / 2, 0.5, 0.3, 1.5, true, false, "M", "Full")};
        nine.renderMode = "immersive";
        nine.hq = true;
        nine.walls = true;
        nine.wallAbs = 0.55;
        nine.roomAmt = 0.06;
        float[] out = render(nine.build(), program, 2 * SR);
        double p = Math.max(peak(out, 0, 0), peak(out, 1, 0)), level = Math.sqrt((rms(out, 0, 0) * rms(out, 0, 0) + rms(out, 1, 0) * rms(out, 1, 0)) / 2);
        assertTrue("nine-box peak " + p, p > 0.02 && p < 0.1);
        assertTrue("nine-box level " + level, level > 0.005 && level < 0.35);
    }

    @Test
    public void reverbTailOnlyWhenEnabled() {
        Signal click = new Signal() {
            public double left(int i) {
                return i == 0 ? 0.5 : 0;
            }

            public double right(int i) {
                return left(i);
            }
        };
        StageConfig.Builder b = new StageConfig.Builder();
        b.renderMode = "room";
        b.roomAmt = 0.3;
        float[] tail = render(b.build(), click, SR / 2);
        b.roomAmt = 0;
        float[] dry = render(b.build(), click, SR / 2);
        int after = (int) (0.2 * SR);
        assertTrue("late tail present", rms(tail, 0, after) > 1e-6);
        assertTrue("no tail without reverb", rms(dry, 0, after) < 1e-9);
    }

    @Test
    public void silenceStaysSilentInEveryMode() {
        for (String mode : new String[]{"clarity", "room", "immersive"}) {
            StageConfig.Builder b = new StageConfig.Builder();
            b.renderMode = mode;
            b.hq = true;
            b.walls = true;
            b.roomAmt = 0.2;
            b.hpdev = "AirPods 4";
            float[] out = render(b.build(), sine(0, 0, 1000), SR / 4);
            for (float v : out) {
                assertFalse(Float.isNaN(v));
                assertEquals(0, v, 1e-12);
            }
        }
    }

    @Test
    public void liveConfigChangesGlideWithoutClicks() {
        StageConfig.Builder b = new StageConfig.Builder();
        StageEngine engine = new StageEngine(SR, b.build());
        float[] in = new float[BLOCK * 2], out = new float[BLOCK * 2];
        double last = 0, worst = 0;
        for (int blockIndex = 0; blockIndex < 200; blockIndex++) {
            if (blockIndex % 10 == 5) {
                b.listenerX = 2 + (blockIndex % 50) / 10.0;
                b.walls = blockIndex > 100;
                engine.setConfig(b.build());
            }
            for (int i = 0; i < BLOCK; i++) {
                double s = 0.3 * Math.sin(2 * Math.PI * 220 * (blockIndex * BLOCK + i) / SR);
                in[2 * i] = (float) s;
                in[2 * i + 1] = (float) s;
            }
            engine.process(in, out, BLOCK);
            for (int i = 0; i < BLOCK; i++) {
                worst = Math.max(worst, Math.abs(out[2 * i] - last));
                last = out[2 * i];
                assertFalse(Float.isNaN(out[2 * i]));
            }
        }
        // A 220 Hz sine at this level moves at most ~0.01 per sample; clicks would be far larger.
        assertTrue("largest sample step " + worst, worst < 0.05);
    }

    @Test
    public void parsesTheWebProjectFormat() throws Exception {
        String json = "{\"schema\":1,\"room\":{\"w\":12,\"l\":9,\"h\":3},\"listener\":{\"x\":6,\"y\":4.5,\"yaw\":0.5,\"pitch\":0},"
                + "\"speakers\":[{\"x\":2,\"y\":2,\"h\":1.6,\"v\":1.1,\"sub\":false,\"ch\":\"L\",\"band\":\"Vocal\"},{\"x\":6,\"y\":8,\"h\":0.3,\"v\":1.4,\"sub\":true,\"ch\":\"M\",\"band\":\"Full\",\"mute\":true}],"
                + "\"furniture\":[{\"type\":\"Sofa\",\"x\":1,\"y\":6,\"w\":2,\"d\":0.9,\"h\":1,\"abs\":0.6}],"
                + "\"controls\":{\"walls\":true,\"wallAbs\":\"0.6\",\"roomAmt\":\"0.05\",\"furn\":\"Furnished\",\"preset\":\"\",\"air\":false,\"renderMode\":\"room\",\"hq\":false,"
                + "\"width\":\"1.2\",\"align\":true,\"swap\":true,\"bal\":\"-0.1\",\"mvol\":\"0.8\",\"hpdev\":\"EarPods\",\"trimL\":\"1\",\"trimR\":\"0.9\"}}";
        StageConfig c = StageConfig.fromJson(json);
        assertEquals(12, c.roomW, 0);
        assertEquals(0.5, c.yaw, 0);
        assertEquals(2, c.speakers.length);
        assertEquals("Vocal", c.speakers[0].band);
        assertTrue(c.speakers[1].sub && c.speakers[1].mute);
        assertEquals(1, c.furniture.length);
        assertTrue(c.walls && c.swap);
        assertEquals(0.6, c.wallAbs, 1e-12);
        assertEquals(0.05, c.roomAmt, 1e-12);
        assertEquals("room", c.renderMode);
        assertEquals(1.2, c.width, 1e-12);
        assertEquals(-0.1, c.bal, 1e-12);
        assertEquals("EarPods", c.hpdev);
        assertEquals(0.9, c.trimR, 1e-12);
        StageConfig hostile = StageConfig.fromJson("{\"room\":{\"w\":1e9},\"speakers\":[{\"x\":\"NaN\",\"v\":99}],\"controls\":{\"mvol\":\"-5\",\"renderMode\":\"<script>\"}}");
        assertEquals(30, hostile.roomW, 0);
        assertEquals(4, hostile.speakers[0].v, 0);
        assertEquals(0, hostile.mvol, 0);
        assertEquals("clarity", hostile.renderMode);
    }
}
