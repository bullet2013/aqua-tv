package io.github.bullet2013.aquatv;

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Tracks;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.analytics.AnalyticsListener;
import androidx.media3.exoplayer.source.LoadEventInfo;
import androidx.media3.exoplayer.source.MediaLoadData;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.VideoSize;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.Collections;
import java.util.Set;

/** Remote AQUA TV HTML with native HLS playback and an origin-restricted bridge. */
public class MainActivity extends Activity {
    private static final String TAG = "AQUA-TV";
    private static final String SITE = "https://bullet2013.github.io/aqua-tv/";
    private static final String ORIGIN = "https://bullet2013.github.io";
    private static final Set<String> ALLOWED_STREAM_HOSTS = Collections.singleton("31.41.12.104");

    private FrameLayout root;
    private PlayerView playerView;
    private WebView webView;
    private ExoPlayer player;
    private ExoSettings exoSettings;
    private String currentStreamAddress = "";
    private boolean muted = false;
    private int videoWidth = 0;
    private int videoHeight = 0;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);
        // TextureView supports proper compositing below a transparent WebView.
        playerView = (PlayerView) LayoutInflater.from(this).inflate(R.layout.native_player, root, false);
        playerView.setUseController(false);
        playerView.setShutterBackgroundColor(Color.BLACK);
        root.addView(playerView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        exoSettings = new ExoSettings(this);
        configurePlayer();

        webView = new WebView(this);
        webView.setBackgroundColor(Color.TRANSPARENT);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String path = uri.getPath();
                return !"https".equalsIgnoreCase(uri.getScheme())
                        || !"bullet2013.github.io".equalsIgnoreCase(uri.getHost())
                        || path == null || !path.startsWith("/aqua-tv/");
            }
        });
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // AndroidX WebMessageListener is safer than addJavascriptInterface:
        // only https://bullet2013.github.io and only the main frame can command video.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "AquaAndroid",
                Collections.singleton(ORIGIN),
                new WebViewCompat.WebMessageListener() {
                    @Override public void onPostMessage(@NonNull WebView view,
                            @NonNull WebMessageCompat message,
                            @NonNull Uri sourceOrigin, boolean isMainFrame,
                            @NonNull JavaScriptReplyProxy replyProxy) {
                        if (!isMainFrame || !ORIGIN.equals(sourceOrigin.toString())) return;
                        String json = message.getData();
                        if (json != null && json.length() < 8192) handleSiteMessage(json);
                    }
                });
        } else {
            Toast.makeText(this, "Обновите Android System WebView", Toast.LENGTH_LONG).show();
        }
        webView.loadUrl(SITE);
    }

    private void configurePlayer() {
        if (player != null) {
            playerView.setPlayer(null);
            player.release();
        }
        player = exoSettings.createPlayer();
        player.setVolume(muted ? 0f : 1f);
        playerView.setPlayer(player);
        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int state) {
                if (exoSettings.diagnosticsEnabled()) {
                    Log.i(TAG, "Exo state=" + state
                            + " bufferedMs=" + player.getTotalBufferedDuration());
                }
                if (state == Player.STATE_READY) notifyPage("playing", "", videoWidth, videoHeight);
                else if (state == Player.STATE_BUFFERING) notifyPage("buffering", "", videoWidth, videoHeight);
            }
            @Override public void onVideoSizeChanged(@NonNull VideoSize size) {
                videoWidth = size.width;
                videoHeight = size.height;
                notifyPage("size", "", videoWidth, videoHeight);
            }
            @Override public void onTracksChanged(@NonNull Tracks tracks) {
                if (!exoSettings.diagnosticsEnabled()) return;
                for (Tracks.Group group : tracks.getGroups()) {
                    for (int i = 0; i < group.length; i++) {
                        if (!group.isTrackSelected(i)) continue;
                        androidx.media3.common.Format format = group.getTrackFormat(i);
                        Log.i(TAG, "Selected track mime=" + format.sampleMimeType
                                + " codec=" + format.codecs
                                + " bitrate=" + format.bitrate
                                + " size=" + format.width + "x" + format.height);
                    }
                }
            }
            @Override public void onPlayerError(@NonNull PlaybackException error) {
                String label = error.getErrorCodeName();
                Throwable cause = error;
                while (cause != null) {
                    if (cause instanceof HttpDataSource.InvalidResponseCodeException) {
                        label += " · HTTP " + ((HttpDataSource.InvalidResponseCodeException) cause).responseCode;
                        break;
                    }
                    cause = cause.getCause();
                }
                Log.e(TAG, "Media3 playback failed: " + label, error);
                notifyPage("error", label, 0, 0);
            }
        });
        if (exoSettings.diagnosticsEnabled()) {
            player.addAnalyticsListener(new AnalyticsListener() {
                @Override public void onLoadError(AnalyticsListener.EventTime time,
                        LoadEventInfo loadInfo, MediaLoadData mediaInfo,
                        IOException error, boolean wasCanceled) {
                    // Do not log full URLs: HLS stream URLs may contain credentials or tokens.
                    String label = error.getClass().getSimpleName();
                    if (error instanceof HttpDataSource.InvalidResponseCodeException) {
                        label += " HTTP " + ((HttpDataSource.InvalidResponseCodeException) error).responseCode;
                    }
                    Log.w(TAG, "Exo load error: " + label
                            + " dataType=" + mediaInfo.dataType
                            + " canceled=" + wasCanceled);
                }
                @Override public void onDownstreamFormatChanged(AnalyticsListener.EventTime time,
                        MediaLoadData mediaInfo) {
                    if (mediaInfo.trackFormat != null) {
                        Log.i(TAG, "Format mime=" + mediaInfo.trackFormat.sampleMimeType
                                + " bitrate=" + mediaInfo.trackFormat.bitrate);
                    }
                }
            });
        }
    }

    private void applyExoSettings() {
        String streamToRestart = currentStreamAddress;
        configurePlayer();
        if (!streamToRestart.isEmpty()) playStream(streamToRestart);
    }

    private void handleSiteMessage(String json) {
        try {
            JSONObject obj = new JSONObject(json);
            switch (obj.optString("type", "")) {
                case "play": playStream(obj.optString("url", "")); break;
                case "rect": positionVideo(obj); break;
                case "mute":
                    muted = obj.optBoolean("muted", false);
                    if (player != null) player.setVolume(muted ? 0f : 1f);
                    break;
                case "exoSettings":
                    runOnUiThread(() -> exoSettings.showDialog(this, this::applyExoSettings));
                    break;
                default: break;
            }
        } catch (JSONException exception) { Log.w(TAG, "Bad bridge JSON", exception); }
    }

    private void playStream(String address) {
        try {
            Uri uri = Uri.parse(address);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))
                    || host == null || !ALLOWED_STREAM_HOSTS.contains(host.toLowerCase())) {
                notifyPage("error", "Не разрешён сервер канала: " + host, 0, 0);
                return;
            }
            currentStreamAddress = address;
            videoWidth = videoHeight = 0;
            if (exoSettings.diagnosticsEnabled()) Log.i(TAG, "Opening stream host=" + host);
            player.setMediaItem(exoSettings.createMediaItem(uri));
            player.prepare();
            player.play();
        } catch (Exception exception) {
            notifyPage("error", "Поток: " + exception.getMessage(), 0, 0);
        }
    }

    private void positionVideo(JSONObject rect) {
        if (!rect.optBoolean("visible", true)) {
            playerView.setVisibility(View.INVISIBLE);
            return;
        }
        double viewportWidth = rect.optDouble("viewportWidth", 0);
        double viewportHeight = rect.optDouble("viewportHeight", 0);
        if (viewportWidth <= 0 || viewportHeight <= 0 || webView.getWidth() <= 0) return;
        double sx = webView.getWidth() / viewportWidth;
        double sy = webView.getHeight() / viewportHeight;
        int x = (int) Math.round(rect.optDouble("x", 0) * sx);
        int y = (int) Math.round(rect.optDouble("y", 0) * sy);
        int w = (int) Math.round(rect.optDouble("width", 0) * sx);
        int h = (int) Math.round(rect.optDouble("height", 0) * sy);
        if (w < 20 || h < 20) return;
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(w, h);
        params.leftMargin = x;
        params.topMargin = y;
        playerView.setLayoutParams(params);
        playerView.setVisibility(View.VISIBLE);
    }

    private void notifyPage(String status, String message, int width, int height) {
        if (webView == null) return;
        String script = "window.AquaNative&&window.AquaNative.onStatus("
                + JSONObject.quote(status) + "," + JSONObject.quote(message) + ","
                + width + "," + height + ");";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    @Override public void onConfigurationChanged(@NonNull Configuration configuration) {
        super.onConfigurationChanged(configuration);
        if (webView != null) webView.post(() -> webView.evaluateJavascript(
                "if(window.updateNativeVideoRect)updateNativeVideoRect()", null));
    }
    @Override public void onBackPressed() {
        new android.app.AlertDialog.Builder(this)
                .setTitle("AQUA TV")
                .setMessage("Выйти из приложения?")
                .setNegativeButton("Отмена", (dialog, which) -> dialog.dismiss())
                .setPositiveButton("Выйти", (dialog, which) -> {
                    if (player != null) player.stop();
                    finish();
                })
                .show();
    }
    @Override protected void onPause() {
        if (player != null) player.pause();
        if (webView != null) webView.onPause();
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        if (player != null && player.getMediaItemCount() > 0) player.play();
    }
    @Override protected void onDestroy() {
        if (playerView != null) playerView.setPlayer(null);
        if (player != null) player.release();
        if (webView != null) { root.removeView(webView); webView.destroy(); }
        super.onDestroy();
    }
}
