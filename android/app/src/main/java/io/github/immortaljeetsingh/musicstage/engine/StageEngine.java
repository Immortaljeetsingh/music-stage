package io.github.immortaljeetsingh.musicstage.engine;

import java.util.Arrays;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Real-time port of the Music Stage Web Audio graph (assets/audio-engine.js) for an interleaved stereo stream.
 *
 * <p>Every virtual speaker receives the incoming stereo mix and follows the browser signal path: band filter,
 * channel routing and bounded crossfeed, speaker gain, air/sub low-pass, obstruction low-pass, distance gain,
 * arrival alignment, then Clarity panning, equal-power 3D panning or the precise head model. Optional first-order
 * wall reflections and a synthetic late tail feed the master bus, followed by output pan, per-ear trims, optional
 * headphone correction, the spatial-mode emergency compressor and the linear -1 dBFS ceiling.
 *
 * <p>Threading: {@link #setConfig} may be called from any thread. Structural changes build a new graph on the
 * caller's thread and cross-fade on the audio thread; parameter changes glide in place. {@link #process} never
 * allocates.
 */
public final class StageEngine {
    public static final double OUTPUT_CEILING = Math.pow(10, -1 / 20.0);
    public static final int MAX_BLOCK = 2048;
    static final double EAR = StageConfig.EAR;
    static final double SOUND_SPEED = 343;
    /** Web Audio low/high-pass Q is in dB: -3.01 dB is linear 1/sqrt(2), a maximally flat Butterworth section. */
    static final double BUTTERWORTH_Q_DB = 20 * Math.log10(Math.sqrt(0.5));
    private static final int REVERB_PARTITION = 512;

    private final int sampleRate;
    private final int fadeLength;
    private final Map<String, Convolver.Kernel> kernels = new LinkedHashMap<>();
    private final AtomicReference<Graph> pendingGraph = new AtomicReference<>();
    private final AtomicReference<Update> pendingUpdate = new AtomicReference<>();
    private String publishedKey;
    private Graph graph, previous;
    private int fadePosition;
    private final float[] inL = new float[MAX_BLOCK], inR = new float[MAX_BLOCK];
    private final float[] outL = new float[MAX_BLOCK], outR = new float[MAX_BLOCK];
    private final float[] oldL = new float[MAX_BLOCK], oldR = new float[MAX_BLOCK];

    private static final class Update {
        final StageConfig config;
        final String key;

        Update(StageConfig config, String key) {
            this.config = config;
            this.key = key;
        }
    }

    public StageEngine(int sampleRate, StageConfig initial) {
        this.sampleRate = sampleRate;
        StageConfig config = initial == null ? StageConfig.defaults() : initial;
        graph = new Graph(config, sampleRate, kernelFor(config));
        publishedKey = graph.key;
        fadeLength = Math.max(1, (int) (0.04 * sampleRate));
    }

    public int sampleRate() {
        return sampleRate;
    }

    /** Applies a new stage. Safe to call from any thread while {@link #process} runs. */
    public synchronized void setConfig(StageConfig config) {
        if (config == null) return;
        String key = Graph.structureKey(config);
        if (key.equals(publishedKey)) {
            pendingUpdate.set(new Update(config, key));
            return;
        }
        pendingUpdate.set(null);
        pendingGraph.set(new Graph(config, sampleRate, kernelFor(config)));
        publishedKey = key;
    }

    /** Renders {@code frames} interleaved stereo frames from {@code in} into {@code out} (may be the same array). */
    public void process(float[] in, float[] out, int frames) {
        for (int offset = 0; offset < frames; ) {
            int n = Math.min(MAX_BLOCK, frames - offset);
            block(in, out, offset, n);
            offset += n;
        }
    }

    private void block(float[] in, float[] out, int offset, int n) {
        Graph next = pendingGraph.getAndSet(null);
        if (next != null) {
            previous = graph;
            graph = next;
            fadePosition = 0;
        }
        Update update = pendingUpdate.getAndSet(null);
        if (update != null && update.key.equals(graph.key)) graph.retarget(update.config);
        int base = offset * 2;
        for (int i = 0; i < n; i++) {
            inL[i] = in[base + 2 * i];
            inR[i] = in[base + 2 * i + 1];
        }
        graph.render(inL, inR, outL, outR, n);
        Graph old = previous;
        if (old != null) {
            old.render(inL, inR, oldL, oldR, n);
            for (int i = 0; i < n; i++) {
                float t = Math.min(1f, (fadePosition + i + 1) / (float) fadeLength);
                outL[i] = oldL[i] + (outL[i] - oldL[i]) * t;
                outR[i] = oldR[i] + (outR[i] - oldR[i]) * t;
            }
            fadePosition += n;
            if (fadePosition >= fadeLength) previous = null;
        }
        for (int i = 0; i < n; i++) {
            out[base + 2 * i] = outL[i];
            out[base + 2 * i + 1] = outR[i];
        }
    }

    private Convolver.Kernel kernelFor(StageConfig c) {
        if (!(c.roomAmt > 0)) return null;
        double[] f = Graph.furnish(c, new double[3]);
        double seconds = Graph.impulseSeconds(c), decay = 3.2 / f[1];
        String key = sampleRate + ":" + seconds + ":" + decay;
        synchronized (kernels) {
            Convolver.Kernel kernel = kernels.get(key);
            if (kernel == null) {
                kernel = new Convolver.Kernel(Graph.buildImpulse(seconds, decay, sampleRate), REVERB_PARTITION);
                if (kernels.size() >= 6) {
                    Iterator<String> oldest = kernels.keySet().iterator();
                    oldest.next();
                    oldest.remove();
                }
                kernels.put(key, kernel);
            }
            return kernel;
        }
    }

    /** One immutable-structure instance of the processing graph. */
    static final class Graph {
        final String key, mode;
        final int sr;
        final boolean clarity, precise, wallsOn, reverbOn;
        final Voice[] voices;
        final Convolver reverb;
        final Biquad wetTone = new Biquad();
        final Smooth wet, master, balance, trimL, trimR;
        final Biquad[] hpL, hpR;
        final double hpPreamp;
        final Compressor compressor;
        final float[] busL = new float[MAX_BLOCK], busR = new float[MAX_BLOCK];
        final float[] mixL = new float[MAX_BLOCK], mixR = new float[MAX_BLOCK];
        final float[] feed = new float[MAX_BLOCK], verbIn = new float[MAX_BLOCK], verbOut = new float[MAX_BLOCK];
        final double[] pan = new double[2], furnishing = new double[3];
        double lx, ly, lz, fx, fy, fz;
        private double balanceCached = 0, balanceLeft = 0, balanceRight = 1;

        Graph(StageConfig c, int sampleRate, Convolver.Kernel kernel) {
            sr = sampleRate;
            key = structureKey(c);
            mode = mode(c);
            clarity = "clarity".equals(mode);
            precise = usePrecise(c);
            wallsOn = c.walls;
            reverbOn = c.roomAmt > 0 && kernel != null;
            wet = new Smooth(0.03, sr);
            master = new Smooth(0.03, sr);
            balance = new Smooth(0.02, sr);
            trimL = new Smooth(0.02, sr);
            trimR = new Smooth(0.02, sr);
            reverb = reverbOn ? new Convolver(kernel) : null;
            HeadphoneProfiles.Profile profile = HeadphoneProfiles.get(c.hpdev);
            if (profile != null) {
                hpPreamp = Math.pow(10, profile.preampDb / 20);
                hpL = new Biquad[profile.filters.length];
                hpR = new Biquad[profile.filters.length];
                for (int j = 0; j < hpL.length; j++) {
                    double[] f = profile.filters[j];
                    hpL[j] = new Biquad();
                    hpR[j] = new Biquad();
                    hpL[j].configure((int) f[1], f[0], f[3], f[2], sr);
                    hpR[j].configure((int) f[1], f[0], f[3], f[2], sr);
                }
            } else {
                hpPreamp = 1;
                hpL = new Biquad[0];
                hpR = new Biquad[0];
            }
            compressor = clarity ? null : new Compressor(sr);
            int kind = precise ? Chain.PRECISE : clarity ? Chain.CLARITY : Chain.EQUAL_POWER;
            voices = new Voice[c.speakers.length];
            for (int i = 0; i < voices.length; i++) voices[i] = new Voice(c.speakers[i], c.swap, kind, wallsOn, reverbOn, sr);
            retarget(c);
            snap();
        }

        /** Recomputes every parameter target from {@code c}; allocation-free (runs on the audio thread). */
        void retarget(StageConfig c) {
            lx = c.listenerX;
            ly = EAR;
            lz = c.listenerY;
            fx = -Math.sin(c.yaw) * Math.cos(c.pitch);
            fy = Math.sin(c.pitch);
            fz = -Math.cos(c.yaw) * Math.cos(c.pitch);
            double maxDistance = 0.1;
            for (StageConfig.Speaker s : c.speakers) maxDistance = Math.max(maxDistance, distance(c, s));
            master.tgt = c.mvol * rigNormalization(c);
            balance.tgt = c.bal;
            trimL.tgt = c.trimL;
            trimR.tgt = c.trimR;
            furnish(c, furnishing);
            if (reverbOn) {
                wet.tgt = c.roomAmt;
                wetTone.configure(Biquad.LOWPASS, furnishing[2], BUTTERWORTH_Q_DB, 0, sr);
            }
            double reflectivity = 1 - (c.wallAbs != 0 ? c.wallAbs : 0.5);
            double modeScale = clarity ? 0.24 : "room".equals(mode) ? 0.5 : 0.72;
            for (int i = 0; i < voices.length; i++) voices[i].retarget(c.speakers[i], c, this, maxDistance, reflectivity, modeScale);
        }

        void snap() {
            wet.snap();
            master.snap();
            balance.snap();
            trimL.snap();
            trimR.snap();
            for (Voice v : voices) v.snap();
        }

        void render(float[] inL, float[] inR, float[] outL, float[] outR, int n) {
            Arrays.fill(busL, 0, n, 0f);
            Arrays.fill(busR, 0, n, 0f);
            if (reverbOn) Arrays.fill(verbIn, 0, n, 0f);
            for (Voice v : voices) v.render(this, inL, inR, n);
            if (reverbOn) {
                reverb.process(verbIn, verbOut, n);
                for (int i = 0; i < n; i++) {
                    float w = (float) (wetTone.process(verbOut[i]) * wet.next());
                    busL[i] += w;
                    busR[i] += w;
                }
            }
            for (int i = 0; i < n; i++) {
                double gain = master.next(), l = busL[i] * gain, r = busR[i] * gain;
                double p = balance.next();
                if (p != 0) {
                    if (p != balanceCached) {
                        balanceCached = p;
                        double x = p <= 0 ? p + 1 : p;
                        balanceLeft = Math.cos(x * Math.PI / 2);
                        balanceRight = Math.sin(x * Math.PI / 2);
                    }
                    if (p < 0) {
                        double nl = l + r * balanceLeft, nr = r * balanceRight;
                        l = nl;
                        r = nr;
                    } else {
                        double nl = l * balanceLeft, nr = r + l * balanceRight;
                        l = nl;
                        r = nr;
                    }
                }
                l *= trimL.next();
                r *= trimR.next();
                if (hpL.length > 0) {
                    l *= hpPreamp;
                    r *= hpPreamp;
                    for (int j = 0; j < hpL.length; j++) {
                        l = hpL[j].process(l);
                        r = hpR[j].process(r);
                    }
                }
                outL[i] = (float) l;
                outR[i] = (float) r;
            }
            if (compressor != null) compressor.process(outL, outR, n);
            for (int i = 0; i < n; i++) {
                outL[i] = (float) (OUTPUT_CEILING * clamp1(outL[i]));
                outR[i] = (float) (OUTPUT_CEILING * clamp1(outR[i]));
            }
        }

        static String structureKey(StageConfig c) {
            StringBuilder k = new StringBuilder(48);
            k.append(mode(c)).append(usePrecise(c) ? 'P' : '-').append(c.walls ? 'W' : '-').append('|').append(c.hpdev).append('|');
            if (c.roomAmt > 0) {
                double[] f = furnish(c, new double[3]);
                k.append(impulseSeconds(c)).append(',').append(3.2 / f[1]);
            }
            k.append('|');
            for (StageConfig.Speaker s : c.speakers) k.append(channelMode(s, c.swap));
            return k.toString();
        }

        static String mode(StageConfig c) {
            return c.renderMode;
        }

        static boolean usePrecise(StageConfig c) {
            return !"clarity".equals(c.renderMode) && c.hq;
        }

        static double impulseSeconds(StageConfig c) {
            return 0.35 + Math.max(c.roomW, c.roomL) * 0.06;
        }

        /** Room softness: {absorption, reverb time, tail low-pass} from the preset and furniture area. */
        static double[] furnish(StageConfig c, double[] out) {
            double abs = 0.28, rt = 1.0, lp = 4500;
            if ("Furnished".equals(c.furn)) {
                abs = 0.5;
                rt = 0.6;
                lp = 3200;
            } else if ("Cluttered".equals(c.furn)) {
                abs = 0.72;
                rt = 0.35;
                lp = 2200;
            }
            double area = 0;
            for (StageConfig.Box o : c.furniture) area += o.w * o.d * o.abs;
            double soft = Math.min(0.8, area / (c.roomW * c.roomL));
            out[0] = Math.min(0.95, abs + soft);
            out[1] = rt / (1 + 3 * soft);
            out[2] = lp / (1 + soft);
            return out;
        }

        /** Deterministic decaying-noise impulse with the ConvolverNode's default normalization applied. */
        static float[] buildImpulse(double seconds, double decay, int sampleRate) {
            int length = (int) Math.ceil(sampleRate * seconds);
            float[] ir = new float[length];
            long seed = 17;
            double power = 0;
            for (int i = 0; i < length; i++) {
                seed = (1664525L * seed + 1013904223L) & 0xffffffffL;
                double v = (seed / 2147483648.0 - 1) * Math.pow(1 - (double) i / length, decay);
                ir[i] = (float) v;
                power += v * v;
            }
            power = Math.sqrt(power / Math.max(1, length));
            if (!(power >= 0.000125)) power = 0.000125;
            double scale = (1 / power) * Math.pow(10, -58 * 0.05) * (44100.0 / sampleRate);
            for (int i = 0; i < length; i++) ir[i] = (float) (ir[i] * scale);
            return ir;
        }

        static char channelMode(StageConfig.Speaker s, boolean swap) {
            if (s.sub) return 'S';
            char m = s.ch.charAt(0);
            if (swap && m == 'L') return 'R';
            if (swap && m == 'R') return 'L';
            return m;
        }

        static double distance(StageConfig c, StageConfig.Speaker s) {
            double dx = s.x - c.listenerX, dy = s.y - c.listenerY, dh = s.h - EAR;
            return Math.sqrt(dx * dx + dy * dy + dh * dh);
        }

        /** Coherent-sum headroom from speaker gain, distance and routing (web rigNormalization). */
        static double rigNormalization(StageConfig c) {
            boolean clarity = "clarity".equals(c.renderMode);
            double left = 0, right = 0, total = 0;
            for (StageConfig.Speaker s : c.speakers) {
                if (s.mute) continue;
                double weight = Math.max(0, s.v) * Spatial.proxGain(distance(c, s)) * (s.sub ? 1.5 : 1);
                String channel = s.sub ? "SUB" : s.ch;
                if (clarity) {
                    if ("L".equals(channel)) left += weight;
                    else if ("R".equals(channel)) right += weight;
                    else {
                        left += weight;
                        right += weight;
                    }
                } else total += weight * ("M".equals(channel) ? 2 : 1);
            }
            double load = clarity ? Math.max(left, right) : total;
            double volume = c.mvol != 0 ? c.mvol : 1;
            double trim = Math.max(1, Math.max(c.trimL != 0 ? c.trimL : 1, c.trimR != 0 ? c.trimR : 1));
            double downstream = Math.max(1, volume * trim * 1.1);
            double base = clarity ? 0.82 : "room".equals(c.renderMode) ? 0.58 : 0.52;
            double target = base / downstream;
            return load > target ? target / load : 1;
        }

        /** Segment/box intersection between a speaker (plus chain offset) and the listener's ears. */
        static boolean blocked(StageConfig c, StageConfig.Speaker s, double offset) {
            for (StageConfig.Box o : c.furniture) {
                double lo = 0, hi = 1;
                boolean miss = false;
                for (int axis = 0; axis < 3 && !miss; axis++) {
                    double a, b, min, max;
                    if (axis == 0) {
                        a = s.x + offset;
                        b = c.listenerX;
                        min = o.x;
                        max = o.x + o.w;
                    } else if (axis == 1) {
                        a = s.y;
                        b = c.listenerY;
                        min = o.y;
                        max = o.y + o.d;
                    } else {
                        a = s.h;
                        b = EAR;
                        min = 0;
                        max = o.h;
                    }
                    double v = b - a;
                    if (Math.abs(v) < 1e-8) {
                        if (a < min || a > max) miss = true;
                        continue;
                    }
                    double t1 = (min - a) / v, t2 = (max - a) / v;
                    lo = Math.max(lo, Math.min(t1, t2));
                    hi = Math.min(hi, Math.max(t1, t2));
                    if (lo > hi) miss = true;
                }
                if (!miss && hi > 0 && lo < 1) return true;
            }
            return false;
        }

        private static double clamp1(double v) {
            return v > 1 ? 1 : (v < -1 ? -1 : v);
        }
    }

    /** One virtual speaker: band filter, channel matrix, one or two chains, reflections and reverb send. */
    static final class Voice {
        final boolean sub;
        final char mode;
        final Chain[] chains;
        final Tap[] taps;
        final boolean hasFeed;
        final Smooth send;
        final Biquad bandL = new Biquad(), bandR = new Biquad();
        double gainL = 1, gainR = 1, scale = 1, cross;

        Voice(StageConfig.Speaker s, boolean swap, int kind, boolean walls, boolean reverb, int sr) {
            sub = s.sub;
            mode = Graph.channelMode(s, swap);
            if (mode == 'M') chains = new Chain[]{new Chain(0, -0.35, 'L', kind, sr), new Chain(1, 0.35, 'R', kind, sr)};
            else if (mode == 'L') chains = new Chain[]{new Chain(0, 0, 'L', kind, sr)};
            else if (mode == 'R') chains = new Chain[]{new Chain(1, 0, 'R', kind, sr)};
            else chains = new Chain[]{new Chain(2, 0, 'M', kind, sr)};
            hasFeed = walls || (reverb && !sub);
            if (walls) {
                taps = new Tap[6];
                for (int t = 0; t < 6; t++) taps[t] = new Tap(sr);
            } else taps = null;
            send = new Smooth(0.03, sr);
        }

        void retarget(StageConfig.Speaker s, StageConfig c, Graph g, double maxDistance, double reflectivity, double modeScale) {
            int sr = g.sr;
            double d = Graph.distance(c, s);
            String band = sub ? "Sub" : s.band;
            configureBand(bandL, band, sr);
            configureBand(bandR, band, sr);
            gainL = mode == 'L' ? 1 : mode == 'R' ? 0 : 1;
            gainR = mode == 'R' ? 1 : mode == 'L' ? 0 : 1;
            if (sub) {
                gainL = 0.5;
                gainR = 0.5;
            }
            cross = 1 - c.width;
            scale = mode == 'M' ? 1 / (1 + Math.abs(cross)) : 1;
            double level = s.v * (s.mute ? 0 : 1), prox = Spatial.proxGain(d) * (sub ? 1.5 : 1);
            double delay = (c.align ? Math.min(0.09, (maxDistance - d) / SOUND_SPEED) : Math.min(0.05, d / SOUND_SPEED)) * sr;
            for (Chain ch : chains) {
                ch.gain.tgt = level;
                ch.prox.tgt = prox;
                ch.delay.tgt = delay;
                if (sub) ch.air.configure(Biquad.LOWPASS, 120, BUTTERWORTH_Q_DB, 0, sr);
                else if (c.air) ch.air.configure(Biquad.LOWPASS, Math.max(12000, 20000 / (1 + d * 0.08)), BUTTERWORTH_Q_DB, 0, sr);
                else ch.air.setUnity();
                if (Graph.blocked(c, s, ch.offset)) ch.occlusion.configure(Biquad.LOWPASS, 1800, BUTTERWORTH_Q_DB, 0, sr);
                else ch.occlusion.setUnity();
                if (ch.kind == Chain.CLARITY) {
                    Spatial.monoPan(ch.ear == 'L' ? -1 : ch.ear == 'R' ? 1 : 0, g.pan);
                    ch.panL.tgt = g.pan[0];
                    ch.panR.tgt = g.pan[1];
                } else if (ch.kind == Chain.EQUAL_POWER) {
                    Spatial.equalPower(Spatial.azimuth(s.x + ch.offset, s.h, s.y, g.lx, g.ly, g.lz, g.fx, g.fy, g.fz, 0, 1, 0), g.pan);
                    ch.panL.tgt = g.pan[0];
                    ch.panR.tgt = g.pan[1];
                } else ch.headModel(s, c, sr);
            }
            send.tgt = g.reverbOn && !sub ? 0.5 * (1.28 - g.furnishing[0]) : 0;
            if (taps != null) {
                double w = c.roomW, l = c.roomL, h = c.roomH;
                for (int t = 0; t < 6; t++) {
                    double ix = s.x, iy = s.y, ih = s.h;
                    if (t == 0) ix = -s.x;
                    else if (t == 1) ix = 2 * w - s.x;
                    else if (t == 2) iy = -s.y;
                    else if (t == 3) iy = 2 * l - s.y;
                    else if (t == 4) ih = -s.h;
                    else ih = 2 * h - s.h;
                    double dx = ix - c.listenerX, dy = iy - c.listenerY, dh = ih - EAR;
                    double path = Math.sqrt(dx * dx + dy * dy + dh * dh);
                    Tap tap = taps[t];
                    tap.delay.tgt = Math.min(0.1, path / SOUND_SPEED) * sr;
                    tap.gain.tgt = modeScale * reflectivity / (1 + 0.8 * path);
                    Spatial.equalPower(Spatial.azimuth(ix, ih, iy, g.lx, g.ly, g.lz, g.fx, g.fy, g.fz, 0, 1, 0), g.pan);
                    tap.panL.tgt = g.pan[0];
                    tap.panR.tgt = g.pan[1];
                }
            }
        }

        private static void configureBand(Biquad f, String band, int sr) {
            switch (band) {
                case "Sub":
                    f.configure(Biquad.LOWPASS, 120, BUTTERWORTH_Q_DB, 0, sr);
                    break;
                case "Tweeter":
                    f.configure(Biquad.HIGHPASS, 2500, BUTTERWORTH_Q_DB, 0, sr);
                    break;
                case "Bass":
                    f.configure(Biquad.LOWPASS, 300, BUTTERWORTH_Q_DB, 0, sr);
                    break;
                case "Vocal":
                    f.configure(Biquad.BANDPASS, 1200, 0.8, 0, sr);
                    break;
                case "Bright":
                    f.configure(Biquad.HIGHPASS, 5000, BUTTERWORTH_Q_DB, 0, sr);
                    break;
                default:
                    f.setUnity();
            }
        }

        void snap() {
            send.snap();
            for (Chain ch : chains) ch.snap();
            if (taps != null) for (Tap t : taps) t.snap();
        }

        void render(Graph g, float[] inL, float[] inR, int n) {
            float[] oL = g.mixL, oR = g.mixR, feed = g.feed;
            double s = scale, k = cross * scale;
            for (int i = 0; i < n; i++) {
                double l = bandL.process(inL[i]) * gainL, r = bandR.process(inR[i]) * gainR;
                oL[i] = (float) (s * (l + k * r));
                oR[i] = (float) (s * (r + k * l));
            }
            if (hasFeed) Arrays.fill(feed, 0, n, 0f);
            for (Chain ch : chains) ch.render(g, oL, oR, hasFeed ? feed : null, n);
            if (taps != null) for (Tap t : taps) t.render(g, feed, n);
            if (g.reverbOn && !sub) {
                float[] verb = g.verbIn;
                for (int i = 0; i < n; i++) verb[i] += (float) (feed[i] * send.next());
            }
        }
    }

    /** Direct path of one virtual channel of a speaker. */
    static final class Chain {
        static final int CLARITY = 0, EQUAL_POWER = 1, PRECISE = 2;
        final int input, kind;
        final double offset;
        final char ear;
        final Smooth gain, prox, delay, panL, panR;
        final Biquad air = new Biquad(), occlusion = new Biquad();
        final DelayLine line;
        final Biquad eq1, eq2, shadowL, shadowR;
        final DelayLine itdLineL, itdLineR;
        final Smooth itdL, itdR, ildL, ildR, shadowFreqL, shadowFreqR, eq1Gain, eq2Gain;
        double eq1Freq = 8000;

        Chain(int input, double offset, char ear, int kind, int sr) {
            this.input = input;
            this.offset = offset;
            this.ear = ear;
            this.kind = kind;
            gain = new Smooth(0.03, sr);
            prox = new Smooth(0.03, sr);
            delay = new Smooth(0.03, sr);
            panL = new Smooth(0.01, sr);
            panR = new Smooth(0.01, sr);
            line = new DelayLine((int) Math.ceil(0.12 * sr));
            if (kind == PRECISE) {
                eq1 = new Biquad();
                eq2 = new Biquad();
                shadowL = new Biquad();
                shadowR = new Biquad();
                itdLineL = new DelayLine((int) Math.ceil(0.01 * sr));
                itdLineR = new DelayLine((int) Math.ceil(0.01 * sr));
                itdL = new Smooth(0.02, sr);
                itdR = new Smooth(0.02, sr);
                ildL = new Smooth(0.02, sr);
                ildR = new Smooth(0.02, sr);
                shadowFreqL = new Smooth(0.02, sr);
                shadowFreqR = new Smooth(0.02, sr);
                eq1Gain = new Smooth(0.03, sr);
                eq2Gain = new Smooth(0.03, sr);
            } else {
                eq1 = null;
                eq2 = null;
                shadowL = null;
                shadowR = null;
                itdLineL = null;
                itdLineR = null;
                itdL = null;
                itdR = null;
                ildL = null;
                ildR = null;
                shadowFreqL = null;
                shadowFreqR = null;
                eq1Gain = null;
                eq2Gain = null;
            }
        }

        /** Woodworth ITD, van Opstal ILD, head-shadow low-pass and Blauert-band elevation EQ (web setPreciseDir). */
        void headModel(StageConfig.Speaker s, StageConfig c, int sr) {
            double dx = s.x + offset - c.listenerX, dy = s.h - EAR, dz = s.y - c.listenerY, yaw = c.yaw;
            double lx = dx * Math.cos(yaw) - dz * Math.sin(yaw), lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
            double az = Math.atan2(lx, -lz), el = Math.atan2(dy, Math.sqrt(lx * lx + lz * lz));
            double d = Math.sqrt(dx * dx + dy * dy + dz * dz);
            for (int side = -1; side <= 1; side += 2) {
                boolean onSide = Math.sin(az) * side > 0;
                double a = Math.min(Math.abs(az), Math.PI), itd = 0, ild = 0;
                if (!onSide) {
                    double tt = a > Math.PI / 2 ? (Math.sin(a) + Math.PI - a) : (a + Math.sin(a));
                    itd = 0.0875 / 343 * tt;
                    ild = 0.18 * Math.sqrt(8000) * Math.sin(a);
                    if (d < 1) ild += (1 - d) * 10 * Math.sin(a);
                }
                double shadow = onSide ? 19000 : Math.max(2500, 19000 - 16000 * Math.sin(a));
                if (side < 0) {
                    itdL.tgt = itd * sr;
                    ildL.tgt = Math.pow(10, -ild / 20);
                    shadowFreqL.tgt = shadow;
                } else {
                    itdR.tgt = itd * sr;
                    ildR.tgt = Math.pow(10, -ild / 20);
                    shadowFreqR.tgt = shadow;
                }
            }
            double se = Math.max(-1, Math.min(1, Math.sin(el)));
            if (se >= 0) {
                eq1Freq = 8000;
                eq1Gain.tgt = 2 + 6 * se;
            } else {
                eq1Freq = 6000;
                eq1Gain.tgt = 5 * se;
            }
            double behind = Math.cos(az) < 0 ? -Math.cos(az) : 0;
            eq2Gain.tgt = 5 * behind;
        }

        void snap() {
            gain.snap();
            prox.snap();
            delay.snap();
            panL.snap();
            panR.snap();
            if (kind == PRECISE) {
                itdL.snap();
                itdR.snap();
                ildL.snap();
                ildR.snap();
                shadowFreqL.snap();
                shadowFreqR.snap();
                eq1Gain.snap();
                eq2Gain.snap();
            }
        }

        void render(Graph g, float[] oL, float[] oR, float[] feed, int n) {
            float[] busL = g.busL, busR = g.busR;
            int sr = g.sr;
            if (kind == PRECISE) {
                eq1.configure(Biquad.PEAKING, eq1Freq, 1.2, eq1Gain.advance(n), sr);
                eq2.configure(Biquad.PEAKING, 1200, 1, eq2Gain.advance(n), sr);
                shadowL.configure(Biquad.LOWPASS, shadowFreqL.advance(n), BUTTERWORTH_Q_DB, 0, sr);
                shadowR.configure(Biquad.LOWPASS, shadowFreqR.advance(n), BUTTERWORTH_Q_DB, 0, sr);
            }
            for (int i = 0; i < n; i++) {
                double x = (input == 0 ? oL[i] : input == 1 ? oR[i] : oL[i] + oR[i]) * gain.next();
                x = air.process(x);
                if (feed != null) feed[i] += (float) x;
                double y = line.process((float) (occlusion.process(x) * prox.next()), delay.next());
                if (kind == PRECISE) {
                    y = eq2.process(eq1.process(y));
                    busL[i] += (float) shadowL.process(itdLineL.process((float) y, itdL.next()) * ildL.next());
                    busR[i] += (float) shadowR.process(itdLineR.process((float) y, itdR.next()) * ildR.next());
                } else {
                    busL[i] += (float) (y * panL.next());
                    busR[i] += (float) (y * panR.next());
                }
            }
        }
    }

    /** One first-order image-source wall reflection. */
    static final class Tap {
        final DelayLine line;
        final Smooth delay, gain, panL, panR;

        Tap(int sr) {
            line = new DelayLine((int) Math.ceil(0.12 * sr));
            delay = new Smooth(0.03, sr);
            gain = new Smooth(0.03, sr);
            panL = new Smooth(0.01, sr);
            panR = new Smooth(0.01, sr);
        }

        void snap() {
            delay.snap();
            gain.snap();
            panL.snap();
            panR.snap();
        }

        void render(Graph g, float[] feed, int n) {
            float[] busL = g.busL, busR = g.busR;
            for (int i = 0; i < n; i++) {
                double t = line.process(feed[i], delay.next()) * gain.next();
                busL[i] += (float) (t * panL.next());
                busR[i] += (float) (t * panR.next());
            }
        }
    }
}
