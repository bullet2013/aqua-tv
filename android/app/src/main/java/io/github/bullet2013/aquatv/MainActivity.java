package io.github.bullet2013.aquatv;

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
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
import com.google.android.exoplayer2.MediaItem;
import com.google.android.exoplayer2.util.MimeTypes;
import com.google.android.exoplayer2.PlaybackException;
import com.google.android.exoplayer2.Player;
import com.google.android.exoplayer2.video.VideoSize;
import com.google.android.exoplayer2.ExoPlayer;
import com.google.android.exoplayer2.DefaultLoadControl;
import com.google.android.exoplayer2.DefaultRenderersFactory;
import com.google.android.exoplayer2.C;
import com.google.android.exoplayer2.Tracks;
import com.google.android.exoplayer2.Format;
import com.google.android.exoplayer2.ui.PlayerView;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONException;
import org.json.JSONObject;

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
    private FrameLayout videoLayer;
    // Always cover the old video surface until the new stream renders a frame.
    // This mask is below WebView and is positioned over preview or fullscreen.
    private View channelChangeMask;
    private WebView webView;
    private ExoPlayer player;
    private int videoWidth = 0;
    private int videoHeight = 0;
    private long switchStartMs = 0;
    private int switchNumber = 0;
    // Each channel owns its own ExoPlayer and TextureView. ExoPlayer does not
    // render frames from an older MediaItem onto the replacement video surface.
    // Audio is unmuted only after this session's first video frame.
    private boolean userMuted = false;
    private boolean firstFrameShown = false;

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
        // The HTML layout determines preview/fullscreen bounds. A disposable
        // PlayerView is installed inside this layer for EVERY new channel.
        // Keeping the old texture around caused previous-channel ghost frames.
        videoLayer = new FrameLayout(this);
        root.addView(videoLayer, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        channelChangeMask = new View(this);
        channelChangeMask.setBackgroundColor(Color.BLACK);
        channelChangeMask.setVisibility(View.INVISIBLE);
        root.addView(channelChangeMask, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

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

    private void handleSiteMessage(String json) {
        try {
            JSONObject obj = new JSONObject(json);
            switch (obj.optString("type", "")) {
                case "play": playStream(obj.optString("url", "")); break;
                case "rect": positionVideo(obj); break;
                case "mute":
                    userMuted = obj.optBoolean("muted", false);
                    if (player != null)
                        player.setVolume((userMuted || !firstFrameShown) ? 0f : 1f);
                    break;
                default: break;
            }
        } catch (JSONException exception) { Log.w(TAG, "Bad bridge JSON", exception); }
    }

    private long elapsedSwitchMs() {
        return switchStartMs == 0 ? -1 : SystemClock.elapsedRealtime() - switchStartMs;
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

            // Invalidate ALL callbacks from the previous playback session.
            // A frame belonging to channel A must never unlock channel B.
            final int session = ++switchNumber;
            switchStartMs = SystemClock.elapsedRealtime();
            firstFrameShown = false;
            videoWidth = videoHeight = 0;
            channelChangeMask.setVisibility(View.VISIBLE);
            videoLayer.setAlpha(0f);
            Log.i(TAG, "Switch #" + session + " start; new decoder and surface");
            notifyPage("engine", "Android ExoPlayer 2 + FFmpeg Audio", 0, 0);

            // Fully detach the previous TextureView before preparing the next.
            // MediaItem replacement on a reused surface leaves the last frame
            // there and produces the exact ghost-frame bug reported on Android.
            ExoPlayer old = player;
            player = null;
            if (playerView != null) {
                playerView.setPlayer(null);
                videoLayer.removeView(playerView);
                playerView = null;
            }
            if (old != null) {
                old.stop();
                old.release();
            }

            PlayerView nextView = (PlayerView) LayoutInflater.from(this)
                    .inflate(R.layout.native_player, videoLayer, false);
            nextView.setUseController(false);
            nextView.setShutterBackgroundColor(Color.BLACK);
            nextView.setKeepContentOnPlayerReset(false);
            videoLayer.addView(nextView, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT));

            // Keep the FFmpeg audio extension. Reusing only the factories does
            // not share the old decoded output or a stale playback timeline.
            DefaultRenderersFactory renderers = new DefaultRenderersFactory(this)
                    .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
                    .setEnableDecoderFallback(true);
            DefaultLoadControl quickZapping = new DefaultLoadControl.Builder()
                    .setBufferDurationsMs(3000, 12000, 300, 1500)
                    .setPrioritizeTimeOverSizeThresholds(true)
                    .build();
            final ExoPlayer next = new ExoPlayer.Builder(this, renderers)
                    .setLoadControl(quickZapping)
                    .build();
            player = next;
            playerView = nextView;
            next.setAudioAttributes(
                    com.google.android.exoplayer2.audio.AudioAttributes.DEFAULT, true);
            next.setVolume(0f);
            nextView.setPlayer(next);
            next.addListener(new Player.Listener() {
                private boolean isCurrent() {
                    return switchNumber == session && player == next;
                }
                @Override public void onPlaybackStateChanged(int state) {
                    if (!isCurrent()) return;
                    if (state == Player.STATE_READY) {
                        Log.i(TAG, "Switch #" + session + " READY after "
                                + elapsedSwitchMs() + "ms");
                    } else if (state == Player.STATE_BUFFERING) {
                        Log.d(TAG, "Switch #" + session + " buffering after "
                                + elapsedSwitchMs() + "ms");
                        notifyPage("buffering", "", videoWidth, videoHeight);
                    }
                }
                @Override public void onRenderedFirstFrame() {
                    if (!isCurrent() || firstFrameShown) return;
                    firstFrameShown = true;
                    Log.i(TAG, "Switch #" + session + " FIRST VIDEO FRAME after "
                            + elapsedSwitchMs() + "ms");
                    // New, independent renderer guarantees this frame is from
                    // the new channel. Reveal picture and audio together.
                    videoLayer.setAlpha(1f);
                    next.setVolume(userMuted ? 0f : 1f);
                    channelChangeMask.setVisibility(View.INVISIBLE);
                    notifyPage("firstFrame", elapsedSwitchMs() + " мс", 0, 0);
                    notifyPage("playing", "", videoWidth, videoHeight);
                }
                @Override public void onVideoSizeChanged(@NonNull VideoSize size) {
                    if (!isCurrent()) return;
                    videoWidth = size.width;
                    videoHeight = size.height;
                    notifyPage("size", "", videoWidth, videoHeight);
                }
                @Override public void onTracksChanged(@NonNull Tracks tracks) {
                    if (!isCurrent()) return;
                    for (int i = 0; i < tracks.getGroups().size(); i++) {
                        Tracks.Group group = tracks.getGroups().get(i);
                        if (group.getType() != C.TRACK_TYPE_AUDIO) continue;
                        for (int j = 0; j < group.length; j++) {
                            if (!group.isTrackSelected(j)) continue;
                            Format format = group.getTrackFormat(j);
                            Log.i(TAG, "Switch #" + session + " AUDIO "
                                    + format.sampleMimeType + " / " + format.codecs);
                            notifyPage("audio", format.sampleMimeType == null
                                    ? "Не определён" : format.sampleMimeType, 0, 0);
                        }
                    }
                }
                @Override public void onPlayerError(@NonNull PlaybackException error) {
                    if (!isCurrent()) return;
                    Log.e(TAG, "EXO2/FFmpeg playback failed on #" + session, error);
                    notifyPage("error", error.getErrorCodeName(), 0, 0);
                }
            });

            MediaItem.Builder item = new MediaItem.Builder().setUri(uri);
            if (uri.getPath() != null && uri.getPath().toLowerCase().endsWith(".m3u8")) {
                item.setMimeType(MimeTypes.APPLICATION_M3U8);
                item.setLiveConfiguration(new MediaItem.LiveConfiguration.Builder()
                        .setTargetOffsetMs(3000L)
                        .setMinPlaybackSpeed(1.0f)
                        .setMaxPlaybackSpeed(1.03f)
                        .build());
            }
            next.setMediaItem(item.build());
            next.prepare();
            next.play();
        } catch (Exception exception) {
            Log.e(TAG, "Cannot start IPTV stream", exception);
            notifyPage("error", "Поток: " + exception.getMessage(), 0, 0);
        }
    }

    private void positionVideo(JSONObject rect) {
        if (!rect.optBoolean("visible", true)) {
            videoLayer.setVisibility(View.INVISIBLE);
            channelChangeMask.setVisibility(View.INVISIBLE);
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
        videoLayer.setLayoutParams(params);
        // The opaque mask follows exactly the same WebView video rectangle.
        FrameLayout.LayoutParams maskParams = new FrameLayout.LayoutParams(w, h);
        maskParams.leftMargin = x;
        maskParams.topMargin = y;
        channelChangeMask.setLayoutParams(maskParams);
        channelChangeMask.setVisibility(firstFrameShown ? View.INVISIBLE : View.VISIBLE);
        videoLayer.setVisibility(View.VISIBLE);
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
        if (videoLayer != null) videoLayer.removeAllViews();
        if (webView != null) { root.removeView(webView); webView.destroy(); }
        super.onDestroy();
    }
}
