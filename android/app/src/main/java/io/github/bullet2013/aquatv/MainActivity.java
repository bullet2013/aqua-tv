package io.github.bullet2013.aquatv;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;

/**
 * Experimental browser-only AQUA TV: the same hls.js and HTML video that
 * worked in Firefox on localhost. NO ExoPlayer/FFmpeg/native video bridge.
 * This app is intentionally separately installable from regular AQUA TV.
 */
public class MainActivity extends Activity {
    private static final String TAG = "AQUA-WEB-TEST";
    private static final String SITE = "https://bullet2013.github.io/aqua-tv/";
    private static final String MEDIA_HOST = "31.41.12.104";
    private WebView webView;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setVolumeControlStream(android.media.AudioManager.STREAM_MUSIC);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(webView);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        // The live site uses HTTPS, but the channels are HTTP HLS. This
        // setting is ONLY for this separately identifiable experiment.
        // The interceptor below blocks other cleartext hosts.
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onConsoleMessage(ConsoleMessage m) {
                Log.d(TAG, m.messageLevel() + " " + m.message() +
                        " (" + m.sourceId() + ":" + m.lineNumber() + ")");
                return true;
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                return !"https".equalsIgnoreCase(u.getScheme())
                    || !"bullet2013.github.io".equalsIgnoreCase(u.getHost())
                    || u.getPath() == null || !u.getPath().startsWith("/aqua-tv/");
            }
            @Override public WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("http".equalsIgnoreCase(uri.getScheme())
                        && !MEDIA_HOST.equalsIgnoreCase(uri.getHost())) {
                    Log.w(TAG, "Blocked other HTTP resource: " + uri.getHost());
                    return new WebResourceResponse("text/plain", "UTF-8",
                            new ByteArrayInputStream(new byte[0]));
                }
                return null;
            }
            @Override public void onPageFinished(WebView view, String url) {
                if (!url.startsWith(SITE)) return;
                // Adapt the existing two-column Android layout, but RESTORE
                // the HTML <video> visibility disabled for native ExoPlayer.
                // This test does not modify the deployed GitHub Pages site.
                String js = """
                    (function() {
                      document.documentElement.classList.add('aqua-native-android');
                      let style = document.getElementById('aqua-webview-hls-style');
                      if (!style) {
                        style = document.createElement('style');
                        style.id = 'aqua-webview-hls-style';
                        document.head.appendChild(style);
                      }
                      style.textContent = [
                        'html.aqua-native-android,html.aqua-native-android body{background:#e5f6ff!important}',
                        'html.aqua-native-android .video-shell video{opacity:1!important;background:#000!important}',
                        'html.aqua-native-android .video-shell .player-placeholder{display:flex!important}',
                        'html.aqua-native-android .video-shell .player-placeholder[hidden]{display:none!important}',
                        'html.aqua-native-android .fullscreen-stage .video-shell{background:#000!important}',
                        'html.aqua-native-android .preview-slot .video-shell{background:#000!important}',
                        'html.aqua-native-android .guide-view{background:#94d8f9!important}',
                        'html.aqua-native-android .guide-view::before{display:none!important}',
                        'html.aqua-native-android .right-panel{background:rgba(245,252,255,.93)!important}',
                        'html.aqua-native-android .right-panel::before{display:none!important}'
                      ].join('');
                      const full = document.getElementById('fullscreenStage');
                      if (full && !full.dataset.aquaBrowserTap) {
                        full.dataset.aquaBrowserTap = '1';
                        full.addEventListener('click', function() {
                          if (document.getElementById('guideView').hidden &&
                              typeof setGuide === 'function') setGuide(true);
                        });
                      }
                    })();
                    """;
                view.evaluateJavascript(js, null);
            }
        });
        webView.loadUrl(SITE);
    }

    @Override public void onBackPressed() {
        new android.app.AlertDialog.Builder(this)
                .setTitle("AQUA TV WEB TEST")
                .setMessage("Выйти из приложения?")
                .setNegativeButton("Отмена", (dialog, which) -> dialog.dismiss())
                .setPositiveButton("Выйти", (dialog, which) -> finish())
                .show();
    }
    @Override protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }
    @Override protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
