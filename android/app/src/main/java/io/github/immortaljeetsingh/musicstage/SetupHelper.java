package io.github.immortaljeetsingh.musicstage;

import android.content.Context;
import android.content.pm.PackageManager;
import java.lang.reflect.Method;
import rikka.shizuku.Shizuku;

/**
 * One-time setup: the DUMP permission (to find other apps' audio sessions) and the PROJECT_MEDIA app-op (so the
 * screen-capture prompt is not shown on every start) can only be granted by the shell user, through ADB or Shizuku.
 */
final class SetupHelper {
    static final int SHIZUKU_REQUEST = 7301;

    private SetupHelper() {
    }

    static String shellCommand(Context context) {
        String pkg = context.getPackageName();
        return "pm grant " + pkg + " android.permission.DUMP && appops set " + pkg + " PROJECT_MEDIA allow";
    }

    static String adbCommand(Context context) {
        String pkg = context.getPackageName();
        return "adb shell pm grant " + pkg + " android.permission.DUMP && adb shell appops set " + pkg + " PROJECT_MEDIA allow";
    }

    static boolean hasDumpPermission(Context context) {
        return context.checkSelfPermission("android.permission.DUMP") == PackageManager.PERMISSION_GRANTED;
    }

    static boolean shizukuRunning() {
        try {
            return Shizuku.pingBinder();
        } catch (Throwable t) {
            return false;
        }
    }

    static boolean shizukuGranted() {
        try {
            return Shizuku.pingBinder() && !Shizuku.isPreV11() && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED;
        } catch (Throwable t) {
            return false;
        }
    }

    /** Runs {@code command} with Shizuku's shell identity and returns its exit code. Blocks; call off the UI thread. */
    static int runWithShizuku(String command) throws Exception {
        Method newProcess = Shizuku.class.getDeclaredMethod("newProcess", String[].class, String[].class, String.class);
        newProcess.setAccessible(true);
        java.lang.Process process = (java.lang.Process) newProcess.invoke(null, new String[]{"sh", "-c", command}, null, null);
        if (process == null) throw new IllegalStateException("Shizuku did not start the command.");
        return process.waitFor();
    }
}
