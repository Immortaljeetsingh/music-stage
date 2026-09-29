package io.github.immortaljeetsingh.musicstage;

import android.webkit.WebResourceResponse;
import androidx.webkit.WebViewAssetLoader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Serves the credited demo tracks from the published site under the app's own origin, so the bundled editor can
 * load them without bundling tens of megabytes of audio in the APK.
 */
final class RemoteAssetHandler implements WebViewAssetLoader.PathHandler {
    private static final Pattern SAFE_PATH = Pattern.compile("[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*");
    private final String base;

    RemoteAssetHandler(String base) {
        this.base = base;
    }

    @Override
    public WebResourceResponse handle(String path) {
        if (path == null || !SAFE_PATH.matcher(path).matches() || path.contains("..")) return error(400, "Bad request");
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(base + path).openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            int status = connection.getResponseCode();
            if (status != 200) {
                connection.disconnect();
                return error(status, "Unavailable");
            }
            Map<String, String> headers = new HashMap<>();
            long length = connection.getContentLengthLong();
            if (length >= 0) headers.put("Content-Length", Long.toString(length));
            headers.put("Cache-Control", "no-cache");
            return new WebResourceResponse(mime(path), null, 200, "OK", headers, connection.getInputStream());
        } catch (IOException e) {
            if (connection != null) connection.disconnect();
            return error(503, "Offline");
        }
    }

    private static WebResourceResponse error(int status, String reason) {
        return new WebResourceResponse("text/plain", "utf-8", status, reason, new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    private static String mime(String path) {
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".flac")) return "audio/flac";
        if (path.endsWith(".mp3")) return "audio/mpeg";
        return "application/octet-stream";
    }
}
