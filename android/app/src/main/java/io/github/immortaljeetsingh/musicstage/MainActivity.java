package io.github.immortaljeetsingh.musicstage;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.media.projection.MediaProjectionConfig;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.webkit.WebViewAssetLoader;
import java.util.ArrayList;
import java.util.List;
import rikka.shizuku.Shizuku;

/** Hosts the bundled Music Stage editor and drives the system-wide processing setup and permissions. */
public final class MainActivity extends Activity {
    private static final String ORIGIN_HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + ORIGIN_HOST + "/assets/web/index.html";
    private static final String DEMO_BASE = "https://immortaljeetsingh.github.io/music-stage/demos/";
    private static final int REQUEST_FILE = 11, REQUEST_PROJECTION = 12, REQUEST_PERMISSIONS = 13;
    private static final int DARK_BACKGROUND = Color.rgb(5, 7, 12), LIGHT_BACKGROUND = Color.rgb(237, 242, 248);

    private final Handler main = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private WebView web;
    private WebViewAssetLoader assets;
    private ValueCallback<Uri[]> fileCallback;
    private boolean resumed, startAfterPermissions;

    private final Runnable statusPump = new Runnable() {
        @Override
        public void run() {
            pushStatus();
            if (resumed) main.postDelayed(this, 1000);
        }
    };

    private final Shizuku.OnRequestPermissionResultListener shizukuListener = (requestCode, grantResult) -> {
        if (requestCode != SetupHelper.SHIZUKU_REQUEST) return;
        if (grantResult == PackageManager.PERMISSION_GRANTED) main.post(this::grantWithShizuku);
        else {
            SystemStatus.setupMessage = getString(R.string.setup_shizuku_denied);
            main.post(this::pushStatus);
        }
    };

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        edgeToEdge();
        root = new FrameLayout(this);
        root.setBackgroundColor(DARK_BACKGROUND);
        web = new WebView(this);
        web.setBackgroundColor(DARK_BACKGROUND);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        root.setOnApplyWindowInsetsListener(this::applyInsets);
        setContentView(root);
        configureWebView();
        try {
            Shizuku.addRequestPermissionResultListener(shizukuListener);
        } catch (RuntimeException ignored) {
            // Shizuku is optional.
        }
        if (state == null || web.restoreState(state) == null) web.loadUrl(START_URL);
    }

    @SuppressWarnings("deprecation") // Android 15 enforces edge-to-edge; 11-14 need the explicit opt-in.
    private void edgeToEdge() {
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        else legacyEdgeToEdge();
    }

    @SuppressWarnings("deprecation")
    private void legacyEdgeToEdge() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }

    @SuppressWarnings("deprecation")
    private WindowInsets applyInsets(View view, WindowInsets insets) {
        if (Build.VERSION.SDK_INT >= 30) {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsets.CONSUMED;
        }
        view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
        return insets.consumeSystemWindowInsets();
    }

    private void configureWebView() {
        assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/web/demos/", new RemoteAssetHandler(DEMO_BASE))
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setUserAgentString(settings.getUserAgentString() + " MusicStageAndroid/" + versionName());
        if ((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) WebView.setWebContentsDebuggingEnabled(true);
        web.addJavascriptInterface(new StageBridge(this), "MusicStageAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (ORIGIN_HOST.equals(url.getHost())) return false;
                openExternal(url.toString());
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pushStatus();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), REQUEST_FILE);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
            }
        });
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "1";
        }
    }

    /** Requests the audio-capture permission, then the system's screen-capture consent, then starts the service. */
    void startSystemWide() {
        if (!SetupHelper.hasDumpPermission(this)) {
            SystemStatus.setupMessage = getString(R.string.setup_required);
            pushStatus();
            return;
        }
        List<String> missing = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) missing.add(Manifest.permission.RECORD_AUDIO);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            missing.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (!missing.isEmpty()) {
            startAfterPermissions = true;
            requestPermissions(missing.toArray(new String[0]), REQUEST_PERMISSIONS);
            return;
        }
        MediaProjectionManager manager = getSystemService(MediaProjectionManager.class);
        Intent consent = Build.VERSION.SDK_INT >= 34
                ? manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
                : manager.createScreenCaptureIntent();
        SystemStatus.state = "starting";
        SystemStatus.message = "";
        try {
            startActivityForResult(consent, REQUEST_PROJECTION);
        } catch (ActivityNotFoundException e) {
            SystemStatus.state = "error";
            SystemStatus.message = getString(R.string.error_projection);
        }
        pushStatus();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != REQUEST_PERMISSIONS || !startAfterPermissions) return;
        startAfterPermissions = false;
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startSystemWide();
        else {
            SystemStatus.state = "error";
            SystemStatus.message = getString(R.string.error_audio_permission);
            pushStatus();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
            return;
        }
        if (requestCode == REQUEST_PROJECTION) {
            if (resultCode == RESULT_OK && data != null) {
                SystemAudioService.start(this, resultCode, data);
            } else {
                SystemStatus.state = "off";
                SystemStatus.message = getString(R.string.error_projection_declined);
            }
            pushStatus();
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    void setupWithShizuku() {
        if (!SetupHelper.shizukuRunning()) {
            SystemStatus.setupMessage = getString(R.string.setup_shizuku_not_running);
            pushStatus();
            return;
        }
        try {
            if (Shizuku.isPreV11()) {
                SystemStatus.setupMessage = getString(R.string.setup_shizuku_old);
                pushStatus();
                return;
            }
            if (Shizuku.checkSelfPermission() != PackageManager.PERMISSION_GRANTED) {
                Shizuku.requestPermission(SetupHelper.SHIZUKU_REQUEST);
                return;
            }
        } catch (RuntimeException e) {
            SystemStatus.setupMessage = getString(R.string.setup_shizuku_not_running);
            pushStatus();
            return;
        }
        grantWithShizuku();
    }

    private void grantWithShizuku() {
        SystemStatus.setupMessage = getString(R.string.setup_working);
        pushStatus();
        String command = SetupHelper.shellCommand(this);
        new Thread(() -> {
            String message;
            try {
                int code = SetupHelper.runWithShizuku(command);
                message = code == 0 && SetupHelper.hasDumpPermission(this)
                        ? getString(R.string.setup_done) : getString(R.string.setup_failed_code, code);
            } catch (Exception e) {
                message = getString(R.string.setup_failed, String.valueOf(e.getMessage()));
            }
            SystemStatus.setupMessage = message;
            main.post(this::pushStatus);
        }, "MusicStageSetup").start();
    }

    void pushStatus() {
        if (web == null) return;
        web.evaluateJavascript("window.MusicStageNative&&window.MusicStageNative.onStatus(" + SystemStatus.json(this) + ")", null);
    }

    void copyToClipboard(String text) {
        ClipboardManager clipboard = getSystemService(ClipboardManager.class);
        if (clipboard == null) return;
        clipboard.setPrimaryClip(ClipData.newPlainText(getString(R.string.clipboard_label), text));
        if (Build.VERSION.SDK_INT < 33) Toast.makeText(this, R.string.copied, Toast.LENGTH_SHORT).show();
    }

    void applyAppearance(boolean light) {
        int background = light ? LIGHT_BACKGROUND : DARK_BACKGROUND;
        root.setBackgroundColor(background);
        web.setBackgroundColor(background);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(light ? mask : 0, mask);
            }
        } else legacyBarAppearance(light);
    }

    @SuppressWarnings("deprecation")
    private void legacyBarAppearance(boolean light) {
        View decor = getWindow().getDecorView();
        int flags = decor.getSystemUiVisibility(), mask = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        decor.setSystemUiVisibility(light ? flags | mask : flags & ~mask);
    }

    void openExternal(String url) {
        if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException ignored) {
            // No browser installed.
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        main.removeCallbacks(statusPump);
        main.post(statusPump);
    }

    @Override
    protected void onPause() {
        resumed = false;
        main.removeCallbacks(statusPump);
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        main.removeCallbacksAndMessages(null);
        try {
            Shizuku.removeRequestPermissionResultListener(shizukuListener);
        } catch (RuntimeException ignored) {
            // Shizuku is optional.
        }
        if (web != null) {
            web.removeJavascriptInterface("MusicStageAndroid");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
