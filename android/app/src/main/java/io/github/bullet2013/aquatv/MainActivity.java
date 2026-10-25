package io.github.bullet2013.aquatv;

import android.app.Activity;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
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
    private TextureView vlcView;
    // Hold the last correctly proportioned frame while LibVLC handles a resize.
    private ImageView resizeCover;
    private int resizeSequence = 0;
    private int videoRectX = Integer.MIN_VALUE;
    private int videoRectY = Integer.MIN_VALUE;
    private int videoRectW = 0;
    private int videoRectH = 0;
    private VlcPlayback vlc;
    private String lastStream = "";
    private boolean muted = false;
    private int videoWidth = 0;
    private int videoHeight = 0;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setVolumeControlStream(android.media.AudioManager.STREAM_MUSIC);
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
        vlcView = new TextureView(this);
        vlcView.setVisibility(View.INVISIBLE);
        root.addView(vlcView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        resizeCover = new ImageView(this);
        resizeCover.setBackgroundColor(Color.BLACK);
        resizeCover.setScaleType(ImageView.ScaleType.FIT_CENTER);
        resizeCover.setVisibility(View.INVISIBLE);
        root.addView(resizeCover, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        player = new ExoPlayer.Builder(this).build();
        playerView.setPlayer(player);
        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int state) {
                if (vlc != null && vlc.isActive()) return;
                if (state == Player.STATE_READY) notifyPage("playing", "", videoWidth, videoHeight);
                else if (state == Player.STATE_BUFFERING) notifyPage("buffering", "", videoWidth, videoHeight);
            }
            @Override public void onVideoSizeChanged(@NonNull VideoSize size) {
                if (vlc != null && vlc.isActive()) return;
                videoWidth = size.width;
                videoHeight = size.height;
                notifyPage("size", "", videoWidth, videoHeight);
            }
            @Override public void onPlayerError(@NonNull PlaybackException error) {
                if (vlc != null && vlc.isActive()) return;
                Log.e(TAG, "Media3 playback failed", error);
                notifyPage("error", error.getErrorCodeName(), 0, 0);
            }
        });

        webView = new WebView(this);
        webView.setBackgroundColor(Color.TRANSPARENT);
        webView.clearCache(true);
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
                case "mute": muted = obj.optBoolean("muted", false); player.setVolume(muted ? 0f : 1f); if (vlc != null) vlc.mute(muted); break;
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
            videoWidth = videoHeight = 0;
            lastStream = address;
            if (vlc == null) vlc = new VlcPlayback(this, vlcView, new VlcPlayback.Listener() {
                @Override public void playing() { notifyPage("playing", "", videoWidth, videoHeight); }
                @Override public void frameReady() {
                    // Remove the opaque black layer on a real frame, not on a timer.
                    resizeCover.setVisibility(View.INVISIBLE);
                    vlcView.setAlpha(1f);
                }
                @Override public void size(int w, int h) { videoWidth = w; videoHeight = h; notifyPage("size", "", w, h); }
                @Override public void error() { Log.w(TAG, "LibVLC failed: trying Media3"); playMedia3(Uri.parse(lastStream)); }
            });
            if (vlc.available()) {
                player.stop();
                playerView.setVisibility(View.INVISIBLE);
                vlc.mute(muted);
                resizeCover.setVisibility(View.VISIBLE);
                vlcView.setAlpha(0f);
                vlc.play(uri);
                notifyPage("engine", "Android VLC / LibVLC", 0, 0);
                return;
            }
            playMedia3(uri);
        } catch (Exception exception) {
            notifyPage("error", "Поток: " + exception.getMessage(), 0, 0);
        }
    }

    private void playMedia3(Uri uri) {
        try {
            if (vlc != null) vlc.stop();
            resizeSequence++;
            vlcView.setAlpha(1f);
            resizeCover.setVisibility(View.INVISIBLE);
            resizeCover.setImageDrawable(null);
            playerView.setVisibility(View.VISIBLE);
            notifyPage("engine", "Android Media3 / ExoPlayer", 0, 0);
            MediaItem.Builder item = new MediaItem.Builder().setUri(uri);
            if (uri.getPath() != null && uri.getPath().toLowerCase().endsWith(".m3u8")) {
                item.setMimeType(MimeTypes.APPLICATION_M3U8);
            }
            player.setVolume(muted ? 0f : 1f);
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
            vlcView.setVisibility(View.INVISIBLE);
            resizeCover.setVisibility(View.INVISIBLE);
            return;
        }
        double vw = rect.optDouble("viewportWidth", 0);
        double vh = rect.optDouble("viewportHeight", 0);
        if (vw <= 0 || vh <= 0 || webView.getWidth() <= 0) return;
        double sx = webView.getWidth() / vw;
        double sy = webView.getHeight() / vh;
        int x = (int) Math.round(rect.optDouble("x", 0) * sx);
        int y = (int) Math.round(rect.optDouble("y", 0) * sy);
        int w = (int) Math.round(rect.optDouble("width", 0) * sx);
        int h = (int) Math.round(rect.optDouble("height", 0) * sy);
        if (w < 20 || h < 20) return;
        boolean changed = x != videoRectX || y != videoRectY ||
                w != videoRectW || h != videoRectH;
        if (!changed) return;
        videoRectX = x; videoRectY = y; videoRectW = w; videoRectH = h;
        FrameLayout.LayoutParams position = new FrameLayout.LayoutParams(w, h);
        position.leftMargin = x; position.topMargin = y;
        boolean usingVlc = vlc != null && vlc.isActive();
        if (usingVlc) {
            // Cover the output immediately, before TextureView is relaid out.
            resizeCover.setLayoutParams(new FrameLayout.LayoutParams(position));
            resizeCover.setImageDrawable(null);
            resizeCover.setVisibility(View.VISIBLE);
            vlcView.setAlpha(0f);
            vlc.resize(w, h);
        } else resizeCover.setVisibility(View.INVISIBLE);
        playerView.setLayoutParams(new FrameLayout.LayoutParams(position));
        vlcView.setLayoutParams(new FrameLayout.LayoutParams(position));
        if (usingVlc) {
            playerView.setVisibility(View.INVISIBLE);
            vlcView.setVisibility(View.VISIBLE);
        } else {
            vlcView.setVisibility(View.INVISIBLE);
            playerView.setVisibility(View.VISIBLE);
        }
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
        if (vlc != null) vlc.pause();
        if (player != null) player.pause();
        if (webView != null) webView.onPause();
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        if (vlc != null && vlc.isActive()) vlc.resume();
        else if (player != null && player.getMediaItemCount() > 0) player.play();
    }
    @Override protected void onDestroy() {
        if (vlc != null) vlc.release();
        if (resizeCover != null) resizeCover.setImageDrawable(null);
        if (playerView != null) playerView.setPlayer(null);
        if (player != null) player.release();
        if (webView != null) { root.removeView(webView); webView.destroy(); }
        super.onDestroy();
    }
}
