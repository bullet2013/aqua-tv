package io.github.bullet2013.aquatv;

import android.content.Context;
import android.net.Uri;
import android.util.Log;
import android.view.TextureView;
import android.view.View;

import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;

import java.util.ArrayList;

/** Optional native IPTV engine with software audio codecs (MP2/AC3/etc.).
 * The TextureView is kept underneath the HTML WebView, like Media3's TextureView.
 */
final class VlcPlayback {
    interface Listener {
        void playing();
        void size(int width, int height);
        void error();
    }

    private static final String TAG = "AQUA-TV/VLC";
    private final TextureView video;
    private final Listener listener;
    private LibVLC library;
    private MediaPlayer player;
    private boolean muted;
    private boolean active;
    private boolean failed;

    VlcPlayback(Context context, TextureView video, Listener listener) {
        this.video = video;
        this.listener = listener;
        try {
            ArrayList<String> args = new ArrayList<>();
            args.add("--network-caching=1500");
            args.add("--no-video-title-show");
            library = new LibVLC(context.getApplicationContext(), args);
            player = new MediaPlayer(library);
            player.setEventListener(event -> {
                switch (event.type) {
                    case MediaPlayer.Event.Playing:
                        video.post(() -> { if (active) listener.playing(); });
                        break;
                    case MediaPlayer.Event.EncounteredError:
                        video.post(() -> {
                            if (active) {
                                active = false;
                                failed = true;
                                listener.error();
                            }
                        });
                        break;
                    default:
                        break;
                }
            });
            player.getVLCVout().setVideoView(video);
            player.getVLCVout().attachViews((vout, w, h, visibleW, visibleH, sarNum, sarDen) -> {
                if (w > 0 && h > 0) video.post(() -> {
                    if (active) listener.size(w, h);
                });
            });
        } catch (Throwable e) {
            Log.e(TAG, "LibVLC unavailable, keep Media3 fallback", e);
            failed = true;
            release();
        }
    }

    boolean available() { return player != null && !failed; }
    boolean isActive() { return active; }

    void play(Uri uri) {
        if (!available()) throw new IllegalStateException("LibVLC not available");
        player.stop();
        active = true;
        video.setVisibility(View.VISIBLE);
        Media media = new Media(library, uri);
        try {
            media.addOption(":network-caching=1500");
            player.setMedia(media);
        } finally {
            media.release();
        }
        player.setVolume(muted ? 0 : 100);
        player.play();
    }

    void mute(boolean value) {
        muted = value;
        if (player != null) player.setVolume(muted ? 0 : 100);
    }

    void pause() {
        if (player != null && active && player.isPlaying()) player.pause();
    }
    void resume() {
        if (player != null && active) player.play();
    }
    void stop() {
        active = false;
        if (player != null) player.stop();
        video.setVisibility(View.INVISIBLE);
    }
    void release() {
        if (player != null) {
            player.stop();
            if (player.getVLCVout().areViewsAttached()) player.getVLCVout().detachViews();
            player.release();
            player = null;
        }
        if (library != null) { library.release(); library = null; }
        active = false;
    }
}
