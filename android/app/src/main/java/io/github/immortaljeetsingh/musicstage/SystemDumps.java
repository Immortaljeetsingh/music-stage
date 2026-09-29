package io.github.immortaljeetsingh.musicstage;

import android.os.Build;
import android.os.IBinder;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
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
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Reads audio system-service dumps (requires DUMP granted through ADB or Shizuku) to find sessions, running players,
 * capture policy and no-projection flags. Truncated, failed and unrecognized telemetry is never trusted for muting.
 */
final class SystemDumps {
    static final int FLAG_NO_MEDIA_PROJECTION = 1 << 10;
    private static final long DUMP_TIMEOUT_MS = 3000;
    private static final int MAX_DUMP_CHARS = 4_000_000;

    static final class Session {
        final int id, uid;
        final String usage;

        Session(int id, int uid, String usage) {
            this.id = id;
            this.uid = uid;
            this.usage = usage;
        }
    }

    static final class Player {
        final int uid, session, flags;
        final String state, usage;

        Player(int uid, int session, int flags, String state, String usage) {
            this.uid = uid;
            this.session = session;
            this.flags = flags;
            this.state = state;
            this.usage = usage;
        }
    }

    static final class Snapshot {
        final List<Session> sessions = new ArrayList<>();
        final List<Player> players = new ArrayList<>();
        final Map<String, Boolean> capture = new HashMap<>();
        boolean playerTelemetryComplete;
    }

    private static final class ReadState {
        final StringBuilder text = new StringBuilder();
        volatile boolean complete;
    }

    private static final Pattern POLICY_SESSION = Pattern.compile(
            "Session I[Dd]:\\s*(\\d+)[;,]?\\s*(?:UID:|uid)\\s*(\\d+)[\\s\\S]{0,800}?Usage:\\s*(\\w+)");
    private static final Pattern CAPTURE_POLICY = Pattern.compile(
            "allowPlaybackCapture=(true|false)\\s*,[^\\n]*?packageName=([\\w.:]+)");
    private static final Pattern PLAYER_UID = Pattern.compile("u/pid:(\\d+)/");
    private static final Pattern PLAYER_STATE = Pattern.compile("state:(\\w+)");
    private static final Pattern PLAYER_USAGE = Pattern.compile("usage=(\\w+)");
    private static final Pattern PLAYER_FLAGS = Pattern.compile("flags=0x([0-9A-Fa-f]+)");
    private static final Pattern PLAYER_SESSION = Pattern.compile("session(?:Id| ID):\\s*(\\d+)");

    private SystemDumps() {
    }

    static Snapshot read() {
        String policy = dump("media.audio_policy");
        String audio = dump("audio");
        if ((policy == null || policy.isEmpty()) && (audio == null || audio.isEmpty())) return null;
        Snapshot snapshot = new Snapshot();
        Map<Integer, Session> byId = new HashMap<>();
        if (policy != null) {
            Matcher m = POLICY_SESSION.matcher(policy);
            while (m.find()) put(byId, parse(m.group(1), 0), parse(m.group(2), -1), m.group(3));
            Matcher c = CAPTURE_POLICY.matcher(policy);
            while (c.find()) snapshot.capture.put(c.group(2).replace("shared:", ""), "true".equals(c.group(1)));
        }

        boolean telemetryComplete = audio != null && !audio.isEmpty();
        boolean sawPlayerRow = false;
        if (audio != null) {
            for (String line : audio.split("\n")) {
                boolean modern = line.contains("AudioPlaybackConfiguration");
                boolean legacy = line.trim().startsWith("ID:") && line.contains("-- u/pid:");
                boolean playerLike = line.contains("u/pid:") && line.contains("state:") && line.contains("usage=");
                if (!modern && !legacy) {
                    if (playerLike) telemetryComplete = false;
                    continue;
                }
                sawPlayerRow = true;
                String uidText = find(PLAYER_UID, line);
                String state = find(PLAYER_STATE, line);
                String usage = find(PLAYER_USAGE, line);
                String flagsText = find(PLAYER_FLAGS, line);
                int uid = parse(uidText, -1);
                if (uid < 0 || state == null || usage == null || flagsText == null) {
                    telemetryComplete = false;
                    continue;
                }
                int flags;
                try {
                    flags = (int) Long.parseLong(flagsText, 16);
                } catch (NumberFormatException ignored) {
                    telemetryComplete = false;
                    continue;
                }
                int session = Build.VERSION.SDK_INT >= 31 ? parse(find(PLAYER_SESSION, line), 0) : 0;
                if (Build.VERSION.SDK_INT >= 31 && "started".equalsIgnoreCase(state)
                        && capturable(usage) && session <= 0) telemetryComplete = false;
                snapshot.players.add(new Player(uid, session, flags, state, usage));
                if (session > 0) put(byId, session, uid, usage);
            }
        }
        if (!byId.isEmpty() && !sawPlayerRow) telemetryComplete = false;
        snapshot.playerTelemetryComplete = telemetryComplete;
        snapshot.sessions.addAll(byId.values());
        return snapshot;
    }

    static boolean capturable(String usage) {
        String normalized = usage == null ? "" : usage.replace("AUDIO_USAGE_", "USAGE_");
        return "USAGE_MEDIA".equals(normalized) || "USAGE_GAME".equals(normalized) || "USAGE_UNKNOWN".equals(normalized);
    }

    private static void put(Map<Integer, Session> byId, int session, int uid, String usage) {
        if (session > 0 && uid >= 0) byId.put(session, new Session(session, uid, usage));
    }

    private static String find(Pattern pattern, String text) {
        Matcher m = pattern.matcher(text);
        return m.find() ? m.group(1) : null;
    }

    private static int parse(String value, int fallback) {
        if (value == null) return fallback;
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    static String dump(String service) {
        IBinder binder = null;
        try {
            Method getService = Class.forName("android.os.ServiceManager").getMethod("getService", String.class);
            binder = (IBinder) getService.invoke(null, service);
        } catch (ReflectiveOperationException | RuntimeException ignored) {
            // Fall through to the bounded dumpsys process.
        }
        if (binder != null) {
            try {
                return usable(dumpBinder(binder));
            } catch (Exception ignored) {
                // Fall through to the bounded dumpsys process.
            }
        }
        return usable(dumpsys(service));
    }

    private static String usable(String result) {
        return result == null || result.contains("Permission Denial") ? null : result;
    }

    private static String dumpBinder(IBinder binder) throws Exception {
        ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createPipe();
        ParcelFileDescriptor readSide = pipe[0];
        ParcelFileDescriptor writeSide = pipe[1];
        ReadState state = new ReadState();
        AtomicBoolean producerComplete = new AtomicBoolean();
        Thread reader = new Thread(() -> readAll(new ParcelFileDescriptor.AutoCloseInputStream(readSide), state), "MusicStageDumpRead");
        Thread producer = new Thread(() -> {
            try {
                binder.dump(writeSide.getFileDescriptor(), new String[0]);
                producerComplete.set(true);
            } catch (Exception ignored) {
                // An aborted producer can never authorize session muting.
            } finally {
                try {
                    writeSide.close();
                } catch (IOException ignored) {
                    // Closed by timeout cleanup.
                }
            }
        }, "MusicStageDumpWrite");
        reader.setDaemon(true);
        producer.setDaemon(true);
        long deadline = SystemClock.elapsedRealtime() + DUMP_TIMEOUT_MS;
        reader.start();
        producer.start();
        producer.join(DUMP_TIMEOUT_MS);
        long remaining = Math.max(0, deadline - SystemClock.elapsedRealtime());
        if (!producerComplete.get() || producer.isAlive()) {
            closeQuietly(writeSide);
            closeQuietly(readSide);
            return null;
        }
        reader.join(remaining);
        if (reader.isAlive() || !state.complete) {
            closeQuietly(readSide);
            return null;
        }
        return state.text.toString();
    }

    private static void closeQuietly(ParcelFileDescriptor descriptor) {
        try {
            descriptor.close();
        } catch (IOException ignored) {
            // Already closed by the dump worker.
        }
    }

    private static String dumpsys(String service) {
        java.lang.Process process = null;
        try {
            process = new ProcessBuilder("dumpsys", service).redirectErrorStream(true).start();
            java.lang.Process child = process;
            ReadState state = new ReadState();
            Thread reader = new Thread(() -> readAll(child.getInputStream(), state), "MusicStageDumpsys");
            reader.setDaemon(true);
            reader.start();
            if (!child.waitFor(DUMP_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
                child.destroyForcibly();
                try {
                    child.getInputStream().close();
                } catch (IOException ignored) {
                    // Process teardown already closed it.
                }
                reader.join(250);
                return null;
            }
            if (child.exitValue() != 0) return null;
            reader.join(250);
            return !reader.isAlive() && state.complete ? state.text.toString() : null;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return null;
        } catch (IOException | RuntimeException e) {
            return null;
        } finally {
            if (process != null) process.destroy();
        }
    }

    private static void readAll(InputStream stream, ReadState state) {
        try (BufferedReader in = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            char[] buffer = new char[8192];
            int n;
            while ((n = in.read(buffer)) > 0) {
                synchronized (state.text) {
                    if (state.text.length() + n > MAX_DUMP_CHARS) return;
                    state.text.append(buffer, 0, n);
                }
            }
            state.complete = true;
        } catch (IOException ignored) {
            // Incomplete transport stays false and can never authorize muting.
        }
    }
}
