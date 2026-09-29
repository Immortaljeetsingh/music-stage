package io.github.immortaljeetsingh.musicstage;

import android.webkit.JavascriptInterface;

/**
 * JavaScript interface exposed to the bundled editor only (the WebView never navigates to other origins).
 * Methods run on WebView's bridge thread; UI work is posted to the activity.
 */
final class StageBridge {
    private static final int MAX_CONFIG_CHARS = 262144;
    private final MainActivity activity;

    StageBridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public String getStatus() {
        return SystemStatus.json(activity);
    }

    @JavascriptInterface
    public void setConfig(String json) {
        if (json != null && json.length() <= MAX_CONFIG_CHARS) SystemAudioService.updateConfig(activity, json);
    }

    @JavascriptInterface
    public void start() {
        activity.runOnUiThread(activity::startSystemWide);
    }

    @JavascriptInterface
    public void stop() {
        activity.runOnUiThread(() -> SystemAudioService.stop(activity));
    }

    @JavascriptInterface
    public void setupWithShizuku() {
        activity.runOnUiThread(activity::setupWithShizuku);
    }

    @JavascriptInterface
    public void copyText(String text) {
        if (text != null && text.length() < 2000) activity.runOnUiThread(() -> activity.copyToClipboard(text));
    }

    @JavascriptInterface
    public void setAppearance(String appearance) {
        activity.runOnUiThread(() -> activity.applyAppearance("light".equals(appearance)));
    }

    @JavascriptInterface
    public void openLink(String url) {
        activity.runOnUiThread(() -> activity.openExternal(url));
    }
}
