package io.github.immortaljeetsingh.musicstage;

import android.os.Build;
import android.os.IBinder;
import android.os.ParcelFileDescriptor;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads the audio system-service dumps (requires the DUMP permission granted once through ADB or Shizuku) to find
 * every app's audio session and whether that app allows its playback to be captured.
 */
final class SystemDumps {
    static final class Session {
        final int id, uid;
        final String usage;

        Session(int id, int uid, String usage) {
            this.id = id;
            this.uid = uid;
            this.usage = usage;
        }
    }

    static final class Snapshot {
        final List<Session> sessions = new ArrayList<>();
        /** Package name to the platform's recorded "allowPlaybackCapture" decision. */
        final Map<String, Boolean> capture = new HashMap<>();
    }

    // media.audio_policy: "Session Id: 57 UID: 10123 ... Usage: AUDIO_USAGE_MEDIA" (Android 10-12L) or
    // "Session ID: 57; uid 10123; ... Usage: AUDIO_USAGE_MEDIA" (Android 13+).
    private static final Pattern POLICY_SESSION = Pattern.compile(
            "Session I[Dd]:\\s*(\\d+)[;,]?\\s*(?:UID:|uid)\\s*(\\d+)[\\s\\S]{0,800}?Usage:\\s*(\\w+)");
    private static final Pattern CAPTURE_POLICY = Pattern.compile(
            "allowPlaybackCapture=(true|false)\\s*,[^\\n]*?packageName=([\\w.:]+)");
    // audio (Android 12+): "AudioPlaybackConfiguration piid:.. u/pid:10123/4567 ... usage=USAGE_MEDIA ... sessionId:57"
    private static final Pattern PLAYBACK_CONFIG = Pattern.compile(
            "AudioPlaybackConfiguration[^\\n]*?u/pid:(\\d+)/\\d+[^\\n]*?usage=(\\w+)[^\\n]*?sessionId:(\\d+)");

    private SystemDumps() {
    }

    /** Returns null when no audio dump is readable (permission missing or services unavailable). */
    static Snapshot read() {
        String policy = dump("media.audio_policy");
        String audio = Build.VERSION.SDK_INT >= 31 ? dump("audio") : null;
        if ((policy == null || policy.isEmpty()) && (audio == null || audio.isEmpty())) return null;
        Snapshot snapshot = new Snapshot();
        Map<Integer, Session> byId = new HashMap<>();
        if (policy != null) {
            Matcher m = POLICY_SESSION.matcher(policy);
            while (m.find()) put(byId, m.group(1), m.group(2), m.group(3));
            Matcher c = CAPTURE_POLICY.matcher(policy);
            while (c.find()) snapshot.capture.put(c.group(2).replace("shared:", ""), "true".equals(c.group(1)));
        }
        if (audio != null) {
            Matcher m = PLAYBACK_CONFIG.matcher(audio);
            while (m.find()) put(byId, m.group(3), m.group(1), m.group(2));
        }
        snapshot.sessions.addAll(byId.values());
        return snapshot;
    }

    /** Only media, game and unknown usages can be captured by AudioPlaybackCapture. */
    static boolean capturable(String usage) {
        String u = usage == null ? "" : usage.replace("AUDIO_USAGE_", "USAGE_");
        return "USAGE_MEDIA".equals(u) || "USAGE_GAME".equals(u) || "USAGE_UNKNOWN".equals(u);
    }

    private static void put(Map<Integer, Session> byId, String session, String uid, String usage) {
        try {
            int id = Integer.parseInt(session), owner = Integer.parseInt(uid);
            if (id > 0) byId.put(id, new Session(id, owner, usage));
        } catch (NumberFormatException ignored) {
            // Malformed line; skip it.
        }
    }

    static String dump(String service) {
        IBinder binder = null;
        try {
            Method getService = Class.forName("android.os.ServiceManager").getMethod("getService", String.class);
            binder = (IBinder) getService.invoke(null, service);
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            // Fall through to the dumpsys binary.
        }
        if (binder != null) {
            try {
                return dumpBinder(binder);
            } catch (Exception ignored) {
                // Fall through to the dumpsys binary.
            }
        }
        return dumpsys(service);
    }

    private static String dumpBinder(IBinder binder) throws Exception {
        ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createPipe();
        ParcelFileDescriptor readSide = pipe[0];
        StringBuilder text = new StringBuilder();
        Thread reader = new Thread(() -> readAll(new ParcelFileDescriptor.AutoCloseInputStream(readSide), text), "MusicStageDump");
        reader.start();
        try {
            binder.dumpAsync(pipe[1].getFileDescriptor(), new String[0]);
        } finally {
            pipe[1].close();
        }
        reader.join(3000);
        if (reader.isAlive()) {
            try {
                readSide.close();
            } catch (IOException ignored) {
                // Already closed by the reader.
            }
            reader.join(500);
        }
        synchronized (text) {
            return text.toString();
        }
    }

    private static String dumpsys(String service) {
        java.lang.Process process = null;
        try {
            process = new ProcessBuilder("dumpsys", service).redirectErrorStream(true).start();
            StringBuilder text = new StringBuilder();
            readAll(process.getInputStream(), text);
            process.waitFor();
            synchronized (text) {
                String result = text.toString();
                return result.contains("Permission Denial") ? null : result;
            }
        } catch (IOException | InterruptedException | RuntimeException e) {
            return null;
        } finally {
            if (process != null) process.destroy();
        }
    }

    private static void readAll(InputStream stream, StringBuilder text) {
        try (BufferedReader in = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            char[] buffer = new char[8192];
            int n;
            while ((n = in.read(buffer)) > 0) {
                synchronized (text) {
                    text.append(buffer, 0, n);
                    if (text.length() > 4_000_000) return;
                }
            }
        } catch (IOException ignored) {
            // Timed out or the service closed the pipe; keep what was read.
        }
    }
}
