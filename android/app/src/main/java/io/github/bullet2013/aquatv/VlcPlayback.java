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
    private int windowW;
    private int windowH;
    private int generation;
    private int reportedW;
    private int reportedH;

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
                        video.post(() -> {
                            if (!active) return;
                            // OpenGL owns layout, size must come from decoded media track.
                            refreshLayout();
                            listener.playing();
                            readResolution(generation);
                        });
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
            // Do NOT pass a layout callback without resizing the native video
            // buffer ourselves: android-display will then show SD in a tiny
            // corner. Without a callback LibVLC uses OpenGL fit-to-window.
            player.getVLCVout().attachViews();
            video.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, orr, ob) -> {
                if (r - l != orr - ol || b - t != ob - ot) resize(r - l, b - t);
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
        generation++;
        reportedW = reportedH = 0;
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
        refreshLayout();
        readResolution(generation);
    }

    /** Dimensions in Android physical pixels, not the source video size. */
    void resize(int width, int height) {
        if (width <= 0 || height <= 0 || player == null) return;
        if (windowW == width && windowH == height) return;
        windowW = width;
        windowH = height;
        refreshLayout();
    }

    /** Fit the decoded frame inside fullscreen or preview, preserving SAR. */
    private void refreshLayout() {
        if (player == null || !active || windowW <= 0 || windowH <= 0) return;
        try {
            player.getVLCVout().setWindowSize(windowW, windowH);
            player.setAspectRatio(null);
            player.setScale(0f);
        } catch (RuntimeException ex) {
            Log.w(TAG, "Unable to resize VLC video window", ex);
        }
    }

    /** LibVLC vout layout is not guaranteed to return source resolution.
     * Obtain it from the selected decoded video track when playback starts. */
    private void readResolution(int expectedGeneration) {
        if (player == null || !active || expectedGeneration != generation) return;
        try {
            var track = player.getCurrentVideoTrack();
            if (track != null && track.width > 0 && track.height > 0) {
                if (track.width != reportedW || track.height != reportedH) {
                    reportedW = track.width;
                    reportedH = track.height;
                    listener.size(reportedW, reportedH);
                }
                return;
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "Cannot query current video track yet", e);
        }
        // MPEG TS / HLS tracks can appear after MediaPlayer.Event.Playing.
        video.postDelayed(() -> readResolution(expectedGeneration), 800);
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
        generation++;
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
