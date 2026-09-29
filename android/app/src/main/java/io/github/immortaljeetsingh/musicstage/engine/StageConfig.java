package io.github.immortaljeetsingh.musicstage.engine;

import java.util.Arrays;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Immutable snapshot of a Music Stage project: room, listener, speakers, furniture and sound controls.
 * Field meanings, defaults and limits mirror the web app (assets/project.js captureProject/normalizeProject).
 */
public final class StageConfig {
    /** Listener ear height in metres. */
    public static final double EAR = 1.6;
    /** Upper bound for speakers and furniture, matching the web project importer. */
    public static final int MAX_ITEMS = 32;

    /** One virtual loudspeaker. {@code ch} is L, R or M; {@code band} is Full, Tweeter, Vocal, Bass or Bright. */
    public static final class Speaker {
        public final double x, y, h, v;
        public final boolean sub, mute;
        public final String ch, band;

        public Speaker(double x, double y, double h, double v, boolean sub, boolean mute, String ch, String band) {
            this.x = x;
            this.y = y;
            this.h = h;
            this.v = v;
            this.sub = sub;
            this.mute = mute;
            this.ch = "L".equals(ch) || "R".equals(ch) ? ch : "M";
            this.band = band == null ? "Full" : band;
        }
    }

    /** Axis-aligned furniture box standing on the floor; {@code abs} is its absorption (0..1). */
    public static final class Box {
        public final double x, y, w, d, h, abs;

        public Box(double x, double y, double w, double d, double h, double abs) {
            this.x = x;
            this.y = y;
            this.w = w;
            this.d = d;
            this.h = h;
            this.abs = abs;
        }
    }

    public final double roomW, roomL, roomH, listenerX, listenerY, yaw, pitch;
    public final Speaker[] speakers;
    public final Box[] furniture;
    public final boolean walls, air, hq, align, swap;
    public final double wallAbs, roomAmt, width, bal, mvol, trimL, trimR;
    public final String furn, renderMode, hpdev;

    private StageConfig(Builder b) {
        roomW = clamp(b.roomW, 2, 30, 10);
        roomL = clamp(b.roomL, 2, 30, 10);
        roomH = clamp(b.roomH, 2, 10, 10);
        listenerX = clamp(b.listenerX, 0, roomW, roomW / 2);
        listenerY = clamp(b.listenerY, 0, roomL, roomL / 2);
        yaw = finite(b.yaw, 0);
        pitch = clamp(b.pitch, -Math.PI / 2, Math.PI / 2, 0);
        Speaker[] source = b.speakers == null ? new Speaker[0] : b.speakers;
        Speaker[] list = new Speaker[Math.min(MAX_ITEMS, source.length)];
        int count = 0;
        for (int i = 0; i < list.length; i++) {
            Speaker s = source[i];
            if (s == null) continue;
            list[count++] = new Speaker(clamp(s.x, 0, roomW, roomW / 2), clamp(s.y, 0, roomL, roomL / 2),
                    clamp(s.h, 0, roomH, EAR), clamp(s.v, 0, 4, 1), s.sub, s.mute, s.ch, s.band);
        }
        speakers = Arrays.copyOf(list, count);
        Box[] boxes = b.furniture == null ? new Box[0] : b.furniture;
        Box[] items = new Box[Math.min(MAX_ITEMS, boxes.length)];
        count = 0;
        for (int i = 0; i < items.length; i++) {
            Box o = boxes[i];
            if (o == null) continue;
            double w = clamp(o.w, 0.1, roomW, 1), d = clamp(o.d, 0.1, roomL, 1);
            items[count++] = new Box(clamp(o.x, 0, roomW - w, 0), clamp(o.y, 0, roomL - d, 0), w, d,
                    clamp(o.h, 0.1, roomH, 1), clamp(o.abs, 0, 1, 0.4));
        }
        furniture = Arrays.copyOf(items, count);
        walls = b.walls;
        air = b.air;
        hq = b.hq;
        align = b.align;
        swap = b.swap;
        wallAbs = clamp(b.wallAbs, 0, 1, 0.85);
        roomAmt = clamp(b.roomAmt, 0, 1, 0);
        width = clamp(b.width, 0, 2, 1);
        bal = clamp(b.bal, -1, 1, 0);
        mvol = clamp(b.mvol, 0, 2.5, 0.9);
        trimL = clamp(b.trimL, 0, 1.5, 1);
        trimR = clamp(b.trimR, 0, 1.5, 1);
        furn = "Furnished".equals(b.furn) || "Cluttered".equals(b.furn) ? b.furn : "Empty";
        renderMode = "room".equals(b.renderMode) || "immersive".equals(b.renderMode) ? b.renderMode : "clarity";
        hpdev = b.hpdev == null ? "" : b.hpdev;
    }

    /** Mutable builder; defaults are the web app's default Clarity stage. */
    public static final class Builder {
        public double roomW = 10, roomL = 10, roomH = 10, listenerX = 5, listenerY = 5, yaw, pitch;
        public Speaker[] speakers = {
                new Speaker(2, 2, EAR, 1, false, false, "L", "Full"),
                new Speaker(8, 2, EAR, 1, false, false, "R", "Full")};
        public Box[] furniture = new Box[0];
        public boolean walls, air, hq, align = true, swap;
        public double wallAbs = 0.85, roomAmt, width = 1, bal, mvol = 0.9, trimL = 1, trimR = 1;
        public String furn = "Empty", renderMode = "clarity", hpdev = "";

        public StageConfig build() {
            return new StageConfig(this);
        }
    }

    public static StageConfig defaults() {
        return new Builder().build();
    }

    /** Parses the JSON produced by the web app's captureProject(). Unknown or invalid values fall back to defaults. */
    public static StageConfig fromJson(String json) throws JSONException {
        JSONObject o = new JSONObject(json);
        Builder b = new Builder();
        JSONObject room = o.optJSONObject("room");
        if (room != null) {
            b.roomW = room.optDouble("w", 10);
            b.roomL = room.optDouble("l", 10);
            b.roomH = room.optDouble("h", 10);
        }
        JSONObject listener = o.optJSONObject("listener");
        if (listener != null) {
            b.listenerX = listener.optDouble("x", b.roomW / 2);
            b.listenerY = listener.optDouble("y", b.roomL / 2);
            b.yaw = listener.optDouble("yaw", 0);
            b.pitch = listener.optDouble("pitch", 0);
        }
        JSONArray speakers = o.optJSONArray("speakers");
        if (speakers != null) {
            Speaker[] list = new Speaker[Math.min(MAX_ITEMS, speakers.length())];
            int count = 0;
            for (int i = 0; i < list.length; i++) {
                JSONObject s = speakers.optJSONObject(i);
                if (s == null) continue;
                list[count++] = new Speaker(s.optDouble("x", b.roomW / 2), s.optDouble("y", b.roomL / 2),
                        s.optDouble("h", EAR), s.optDouble("v", 1), s.optBoolean("sub", false),
                        s.optBoolean("mute", false), s.optString("ch", "M"), s.optString("band", "Full"));
            }
            b.speakers = Arrays.copyOf(list, count);
        }
        JSONArray furniture = o.optJSONArray("furniture");
        if (furniture != null) {
            Box[] list = new Box[Math.min(MAX_ITEMS, furniture.length())];
            int count = 0;
            for (int i = 0; i < list.length; i++) {
                JSONObject f = furniture.optJSONObject(i);
                if (f == null) continue;
                list[count++] = new Box(f.optDouble("x", 0), f.optDouble("y", 0), f.optDouble("w", 1),
                        f.optDouble("d", 1), f.optDouble("h", 1), f.optDouble("abs", 0.4));
            }
            b.furniture = Arrays.copyOf(list, count);
        }
        JSONObject c = o.optJSONObject("controls");
        if (c != null) {
            b.walls = bool(c, "walls", false);
            b.wallAbs = c.optDouble("wallAbs", 0.85);
            b.roomAmt = c.optDouble("roomAmt", 0);
            b.furn = c.optString("furn", "Empty");
            b.air = bool(c, "air", false);
            b.renderMode = c.optString("renderMode", "clarity");
            b.hq = bool(c, "hq", false);
            b.width = c.optDouble("width", 1);
            b.align = bool(c, "align", true);
            b.swap = bool(c, "swap", false);
            b.bal = c.optDouble("bal", 0);
            b.mvol = c.optDouble("mvol", 0.9);
            b.hpdev = c.optString("hpdev", "");
            b.trimL = c.optDouble("trimL", 1);
            b.trimR = c.optDouble("trimR", 1);
        }
        return b.build();
    }

    private static boolean bool(JSONObject o, String key, boolean fallback) {
        Object value = o.opt(key);
        if (value instanceof Boolean) return (Boolean) value;
        if (value instanceof String) return "true".equalsIgnoreCase((String) value);
        return fallback;
    }

    private static double finite(double value, double fallback) {
        return Double.isNaN(value) || Double.isInfinite(value) ? fallback : value;
    }

    private static double clamp(double value, double min, double max, double fallback) {
        double v = finite(value, fallback);
        return Math.max(min, Math.min(max, v));
    }
}
