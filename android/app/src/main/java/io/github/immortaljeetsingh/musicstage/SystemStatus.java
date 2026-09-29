package io.github.immortaljeetsingh.musicstage;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import java.util.Arrays;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Process-wide state of system-wide processing, rendered by the web UI's System-wide card. */
final class SystemStatus {
    /** off, starting, running or error. */
    static volatile String state = "off";
    static volatile String message = "";
    static volatile String setupMessage = "";
    static volatile String[] processed = new String[0];
    static volatile String[] blocked = new String[0];
    static volatile String[] unmuted = new String[0];
    static volatile int latencyMs;
    static volatile int underruns;

    private SystemStatus() {
    }

    static void clearSessions() {
        processed = new String[0];
        blocked = new String[0];
        unmuted = new String[0];
    }

    static String json(Context context) {
        JSONObject o = new JSONObject();
        try {
            String current = state;
            o.put("supported", Build.VERSION.SDK_INT >= 29);
            o.put("state", current);
            o.put("running", "running".equals(current) || "starting".equals(current));
            o.put("message", message);
            o.put("setupMessage", setupMessage);
            o.put("dumpGranted", SetupHelper.hasDumpPermission(context));
            o.put("shizukuRunning", SetupHelper.shizukuRunning());
            o.put("shizukuGranted", SetupHelper.shizukuGranted());
            o.put("audioPermission", context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED);
            o.put("adbCommand", SetupHelper.adbCommand(context));
            o.put("processed", new JSONArray(Arrays.asList(processed)));
            o.put("blocked", new JSONArray(Arrays.asList(blocked)));
            o.put("unmuted", new JSONArray(Arrays.asList(unmuted)));
            o.put("latencyMs", latencyMs);
            o.put("underruns", underruns);
            o.put("android", Build.VERSION.RELEASE);
            o.put("sdk", Build.VERSION.SDK_INT);
        } catch (JSONException ignored) {
            // Only non-finite numbers can fail here; none are written.
        }
        return o.toString();
    }
}
