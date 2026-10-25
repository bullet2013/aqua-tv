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
    // Always cover the old video surface until the new stream renders a frame.
    // This mask is below WebView and is positioned over preview or fullscreen.
    private View channelChangeMask;
    private WebView webView;
    private ExoPlayer player;
    private int videoWidth = 0;
    private int videoHeight = 0;
    private long switchStartMs = 0;
    private int switchNumber = 0;
    // Audio starts much earlier than decoded live HLS video on some streams.
    // Start the media immediately, but expose sound only with its first frame.
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
        // TextureView supports proper compositing below a transparent WebView.
        playerView = (PlayerView) LayoutInflater.from(this).inflate(R.layout.native_player, root, false);
        playerView.setUseController(false);
        playerView.setShutterBackgroundColor(Color.BLACK);
        playerView.setKeepContentOnPlayerReset(false);
        root.addView(playerView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        channelChangeMask = new View(this);
        channelChangeMask.setBackgroundColor(Color.BLACK);
        channelChangeMask.setVisibility(View.INVISIBLE);
        root.addView(channelChangeMask, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        // Test the original Google ExoPlayer 2.x pipeline used by OTT-play EXO2.
        // Exo2-mod style experiment: prefer software FFmpeg for audio (MP2, AC3,
        // EAC3, etc.) while keeping the Android hardware video decoder.
        // The extension's audio renderer is discovered reflectively from the AAR.
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
                .setEnableDecoderFallback(true);
        // Default ExoPlayer2 waits for 2500 ms of media at startup. Live TV
        // channel surfing benefits from an earlier start; once playback begins,
        // maintain more data to withstand jitter. Keep FFmpeg renderer enabled.
        DefaultLoadControl quickZapping = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(
                        3000,   // min media buffer while playing
                        12000,  // max media buffer while playing
                        300,    // startup buffer: 300ms rather than 2500ms
                        1500)   // after genuine network rebuffering
                .setPrioritizeTimeOverSizeThresholds(true)
                .build();
        player = new ExoPlayer.Builder(this, renderers)
                .setLoadControl(quickZapping)
                .build();
        player.setAudioAttributes(com.google.android.exoplayer2.audio.AudioAttributes.DEFAULT, true);
        playerView.setPlayer(player);
        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_READY) {
                    Log.i(TAG, "Switch #" + switchNumber + " READY after "
                            + elapsedSwitchMs() + "ms; videoFrame=" + firstFrameShown);
                    // STATE_READY may occur for audio well before video. Do not
                    // tell the webpage the stream is visible until a frame renders.
                } else if (state == Player.STATE_BUFFERING) {
                    Log.d(TAG, "Switch #" + switchNumber + " buffering after "
                            + elapsedSwitchMs() + "ms");
                    notifyPage("buffering", "", videoWidth, videoHeight);
                }
            }
            @Override public void onRenderedFirstFrame() {
                Log.i(TAG, "Switch #" + switchNumber + " FIRST FRAME after "
                        + elapsedSwitchMs() + "ms; liveOffset=" + player.getCurrentLiveOffset());
                if (!firstFrameShown) {
                    firstFrameShown = true;
                    // Synchronize audible sound with the actual displayed frame.
                    // No artificial timeout: playback and decoding ran concurrently.
                    player.setVolume(userMuted ? 0f : 1f);
                    // This callback comes from the video renderer, not from
                    // audio-ready state or a fixed timer.
                    channelChangeMask.setVisibility(View.INVISIBLE);
                    notifyPage("playing", "", videoWidth, videoHeight);
                }
            }
            @Override public void onVideoSizeChanged(@NonNull VideoSize size) {
                videoWidth = size.width;
                videoHeight = size.height;
                notifyPage("size", "", videoWidth, videoHeight);
            }
            @Override public void onTracksChanged(@NonNull Tracks tracks) {
                for (int groupIndex = 0; groupIndex < tracks.getGroups().size(); groupIndex++) {
                    Tracks.Group group = tracks.getGroups().get(groupIndex);
                    if (group.getType() != C.TRACK_TYPE_AUDIO) continue;
                    for (int trackIndex = 0; trackIndex < group.length; trackIndex++) {
                        if (!group.isTrackSelected(trackIndex)) continue;
                        Format fmt = group.getTrackFormat(trackIndex);
                        Log.i(TAG, "EXO2 audio format: " + fmt.sampleMimeType
                                + " codecs=" + fmt.codecs
                                + " channels=" + fmt.channelCount
                                + " supported=" + group.isTrackSupported(trackIndex));
                    }
                }
            }
            @Override public void onPlayerError(@NonNull PlaybackException error) {
                Log.e(TAG, "Legacy ExoPlayer2 playback failed", error);
                notifyPage("error", error.getErrorCodeName(), 0, 0);
            }
        });

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
            switchStartMs = SystemClock.elapsedRealtime();
            switchNumber++;
            Log.i(TAG, "Switch #" + switchNumber + " start");
            firstFrameShown = false;
            // Hide stale video immediately; ExoPlayer can retain the last
            // decoded frame even after switching MediaItem.
            channelChangeMask.setVisibility(View.VISIBLE);
            player.setVolume(0f); // hold audio only until decoded video first frame
            videoWidth = videoHeight = 0;
            MediaItem.Builder item = new MediaItem.Builder().setUri(uri);
            if (uri.getPath() != null && uri.getPath().toLowerCase().endsWith(".m3u8")) {
                item.setMimeType(MimeTypes.APPLICATION_M3U8);
                // Standard live HLS starts about 3 segments behind the edge.
                // IPTV zapping should start at a more recent complete segment.
                // ExoPlayer clamps the offset to available playlist segments.
                item.setLiveConfiguration(new MediaItem.LiveConfiguration.Builder()
                        .setTargetOffsetMs(3000L)
                        .setMinPlaybackSpeed(1.0f)
                        .setMaxPlaybackSpeed(1.03f)
                        .build());
            }
            player.setMediaItem(item.build());
            player.prepare();
            player.play();
        } catch (Exception exception) {
            notifyPage("error", "Поток: " + exception.getMessage(), 0, 0);
        }
    }

    private void positionVideo(JSONObject rect) {
        if (!rect.optBoolean("visible", true)) {
            playerView.setVisibility(View.INVISIBLE);
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
        playerView.setLayoutParams(params);
        // The opaque mask follows exactly the same WebView video rectangle.
        FrameLayout.LayoutParams maskParams = new FrameLayout.LayoutParams(w, h);
        maskParams.leftMargin = x;
        maskParams.topMargin = y;
        channelChangeMask.setLayoutParams(maskParams);
        channelChangeMask.setVisibility(firstFrameShown ? View.INVISIBLE : View.VISIBLE);
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
