package io.github.bullet2013.aquatv;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.text.InputType;
import android.view.View;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.ArrayAdapter;
import android.widget.TextView;
import android.widget.Toast;

import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.decoder.ffmpeg.FfmpegLibrary;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector;
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Device-local ExoPlayer tuning. None of these preferences are read from or
 * transmitted to the remote website; only a trusted bridge command opens this dialog.
 */
@UnstableApi
final class ExoSettings {
    private static final String PREFERENCES = "aqua_exoplayer_v1";
    private static final String[] QUALITY = {"Авто", "480p", "720p", "1080p", "2160p"};
    private static final int[] WIDTH = {0, 854, 1280, 1920, 3840};
    private static final int[] HEIGHT = {0, 480, 720, 1080, 2160};
    private static final String[] BITRATES = {"Авто", "1,5 Мбит/с", "3 Мбит/с", "5 Мбит/с", "8 Мбит/с", "12 Мбит/с", "20 Мбит/с"};
    private static final int[] BITRATE_KBPS = {0, 1500, 3000, 5000, 8000, 12000, 20000};
    private static final String[] FPS = {"Авто", "25 fps", "30 fps", "50 fps", "60 fps"};
    private static final int[] FPS_VALUE = {0, 25, 30, 50, 60};
    private static final String[] AUDIO = {"Авто", "Русский", "Английский"};
    private static final String[] STREAM_TYPES = {"Определять автоматически", "Принудительно HLS"};
    private static final String[] LIVE_DELAY = {"По умолчанию", "3 секунды", "5 секунд", "10 секунд", "15 секунд", "30 секунд"};
    private static final int[] LIVE_DELAY_MS = {0, 3000, 5000, 10000, 15000, 30000};

    private final Context context;
    private final SharedPreferences preferences;

    ExoSettings(Context context) {
        this.context = context;
        preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private int number(String key, int fallback) { return preferences.getInt(key, fallback); }
    private boolean enabled(String key, boolean fallback) { return preferences.getBoolean(key, fallback); }
    private String string(String key) { return preferences.getString(key, ""); }

    ExoPlayer createPlayer() {
        ExoPlayer.Builder builder = new ExoPlayer.Builder(context);

        if (enabled("customBuffer", false)) {
            int min = number("minBufferSec", 15) * 1000;
            int max = number("maxBufferSec", 50) * 1000;
            int start = number("startBufferMs", 1500);
            int rebuffer = number("rebufferMs", 3000);
            builder.setLoadControl(new DefaultLoadControl.Builder()
                    .setBufferDurationsMs(min, max, start, rebuffer)
                    .setBackBuffer(number("backBufferSec", 0) * 1000, false)
                    .setPrioritizeTimeOverSizeThresholds(enabled("prioritizeTime", false))
                    .build());
        }

        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setConnectTimeoutMs(number("connectMs", 8000))
                .setReadTimeoutMs(number("readMs", 8000))
                .setAllowCrossProtocolRedirects(enabled("crossRedirects", false));
        String agent = string("userAgent").trim();
        if (!agent.isEmpty()) http.setUserAgent(agent);
        Map<String, String> headers = new HashMap<>();
        String referer = string("referer").trim();
        String origin = string("origin").trim();
        if (!referer.isEmpty()) headers.put("Referer", referer);
        if (!origin.isEmpty()) headers.put("Origin", origin);
        if (!headers.isEmpty()) http.setDefaultRequestProperties(headers);

        DefaultMediaSourceFactory sourceFactory = new DefaultMediaSourceFactory(context)
                .setDataSourceFactory(new DefaultDataSource.Factory(context, http))
                .setLoadErrorHandlingPolicy(new DefaultLoadErrorHandlingPolicy(number("retries", 3)));
        builder.setMediaSourceFactory(sourceFactory);
        builder.setRenderersFactory(new DefaultRenderersFactory(context)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER)
                .setEnableDecoderFallback(true));

        DefaultTrackSelector tracks = new DefaultTrackSelector(context);
        DefaultTrackSelector.Parameters.Builder trackParams = tracks.buildUponParameters();
        int q = number("quality", 0);
        if (q > 0 && q < QUALITY.length) trackParams.setMaxVideoSize(WIDTH[q], HEIGHT[q]);
        int b = number("bitrate", 0);
        if (b > 0 && b < BITRATES.length) trackParams.setMaxVideoBitrate(BITRATE_KBPS[b] * 1000);
        int f = number("fps", 0);
        if (f > 0 && f < FPS.length) trackParams.setMaxVideoFrameRate(FPS_VALUE[f]);
        trackParams.setForceLowestBitrate(enabled("lowestBitrate", false));
        switch (number("audio", 0)) {
            case 1: trackParams.setPreferredAudioLanguage("ru"); break;
            case 2: trackParams.setPreferredAudioLanguage("en"); break;
            default: break;
        }
        tracks.setParameters(trackParams);
        builder.setTrackSelector(tracks);
        return builder.build();
    }

    MediaItem createMediaItem(Uri uri) {
        MediaItem.Builder item = new MediaItem.Builder().setUri(uri);
        if (number("streamType", 0) == 1 ||
                (uri.getPath() != null && uri.getPath().toLowerCase(java.util.Locale.ROOT).endsWith(".m3u8"))) {
            item.setMimeType(MimeTypes.APPLICATION_M3U8);
        }
        int delay = number("liveDelay", 0);
        if (delay > 0 && delay < LIVE_DELAY_MS.length) {
            item.setLiveConfiguration(new MediaItem.LiveConfiguration.Builder()
                    .setTargetOffsetMs(LIVE_DELAY_MS[delay]).build());
        }
        return item.build();
    }

    boolean diagnosticsEnabled() { return enabled("diagnostics", false); }

    private static int dp(Context context, int size) {
        return Math.round(size * context.getResources().getDisplayMetrics().density);
    }

    private static TextView title(Context c, String value, int size) {
        TextView label = new TextView(c);
        label.setText(value);
        label.setTextSize(size);
        label.setPadding(0, dp(c, 12), 0, dp(c, 4));
        return label;
    }

    private static void section(LinearLayout parent, Activity a, String value) {
        TextView caption = title(a, value, 19);
        caption.setTypeface(null, android.graphics.Typeface.BOLD);
        caption.setPadding(0, dp(a, 20), 0, dp(a, 8));
        parent.addView(caption);
    }

    private void checkbox(LinearLayout root, Activity a, Map<String, CheckBox> checks,
                          String key, String label, boolean fallback) {
        CheckBox box = new CheckBox(a);
        box.setText(label);
        box.setTextSize(15);
        box.setChecked(enabled(key, fallback));
        box.setPadding(0, dp(a, 7), 0, dp(a, 7));
        checks.put(key, box);
        root.addView(box);
    }

    private void integer(LinearLayout root, Activity a, Map<String, EditText> fields,
                         String key, String label, int fallback) {
        root.addView(title(a, label, 14));
        EditText input = new EditText(a);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_NUMBER);
        input.setText(String.valueOf(number(key, fallback)));
        input.setSelectAllOnFocus(true);
        fields.put(key, input);
        root.addView(input);
    }

    private void text(LinearLayout root, Activity a, Map<String, EditText> fields,
                      String key, String label) {
        root.addView(title(a, label, 14));
        EditText input = new EditText(a);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(string(key));
        fields.put(key, input);
        root.addView(input);
    }

    private void select(LinearLayout root, Activity a, Map<String, Spinner> choices,
                        String key, String label, String[] options) {
        root.addView(title(a, label, 14));
        Spinner spinner = new Spinner(a);
        ArrayAdapter<String> adapter = new ArrayAdapter<>(a,
                android.R.layout.simple_spinner_item, options);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        spinner.setAdapter(adapter);
        spinner.setSelection(Math.max(0, Math.min(options.length - 1, number(key, 0))));
        choices.put(key, spinner);
        root.addView(spinner);
    }

    void showDialog(Activity activity, Runnable onApplied) {
        ScrollView scroll = new ScrollView(activity);
        LinearLayout form = new LinearLayout(activity);
        form.setOrientation(LinearLayout.VERTICAL);
        form.setPadding(dp(activity, 18), dp(activity, 8), dp(activity, 18), dp(activity, 20));
        scroll.addView(form);
        Map<String, EditText> numbers = new LinkedHashMap<>();
        Map<String, EditText> strings = new LinkedHashMap<>();
        Map<String, CheckBox> flags = new LinkedHashMap<>();
        Map<String, Spinner> selections = new LinkedHashMap<>();

        form.addView(title(activity,
                "Параметры хранятся только на этом устройстве. Применение перезапускает текущий канал.", 14));
        section(form, activity, "Буферизация");
        checkbox(form, activity, flags, "customBuffer", "Использовать свой размер буфера", false);
        integer(form, activity, numbers, "minBufferSec", "Минимальный буфер (1–180 сек)", 15);
        integer(form, activity, numbers, "maxBufferSec", "Максимальный буфер (1–300 сек)", 50);
        integer(form, activity, numbers, "startBufferMs", "До начала воспроизведения (0–30000 мс)", 1500);
        integer(form, activity, numbers, "rebufferMs", "После прерывания (0–30000 мс)", 3000);
        integer(form, activity, numbers, "backBufferSec", "Сохранять предыдущие кадры (0–60 сек)", 0);
        checkbox(form, activity, flags, "prioritizeTime", "Приоритет времени буфера над объёмом", false);

        section(form, activity, "Сеть и HTTP");
        integer(form, activity, numbers, "connectMs", "Тайм-аут подключения (1000–60000 мс)", 8000);
        integer(form, activity, numbers, "readMs", "Тайм-аут чтения (1000–60000 мс)", 8000);
        integer(form, activity, numbers, "retries", "Количество повторов загрузки (0–10)", 3);
        checkbox(form, activity, flags, "crossRedirects", "Разрешить перенаправления HTTP ↔ HTTPS", false);
        text(form, activity, strings, "userAgent", "User-Agent (пусто = системный)");
        text(form, activity, strings, "referer", "Referer (необязательно)");
        text(form, activity, strings, "origin", "Origin (необязательно)");

        section(form, activity, "Видео, звук и HLS");
        checkbox(form, activity, flags, "decoderFallback", "Резервный декодер при ошибке инициализации", false);
        select(form, activity, selections, "quality", "Максимальное разрешение", QUALITY);
        select(form, activity, selections, "bitrate", "Максимальный битрейт", BITRATES);
        select(form, activity, selections, "fps", "Максимальная частота кадров", FPS);
        checkbox(form, activity, flags, "lowestBitrate", "Выбирать дорожку с минимальным битрейтом", false);
        select(form, activity, selections, "audio", "Предпочитаемый язык звука", AUDIO);
        select(form, activity, selections, "streamType", "Определение HLS (если нет .m3u8)", STREAM_TYPES);
        select(form, activity, selections, "liveDelay", "Желаемая задержка от прямого эфира", LIVE_DELAY);

        section(form, activity, "Диагностика");
        checkbox(form, activity, flags, "diagnostics", "Подробные события ExoPlayer в logcat", false);

        AlertDialog dialog = new AlertDialog.Builder(activity)
                .setTitle("ExoPlayer · Расширенные настройки")
                .setView(scroll)
                .setNegativeButton("Отмена", (d, w) -> {})
                .setNeutralButton("Сбросить", null)
                .setPositiveButton("Применить", null)
                .create();
        dialog.setOnShowListener(ignored -> {
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v -> {
                new AlertDialog.Builder(activity)
                        .setMessage("Сбросить все настройки ExoPlayer?")
                        .setNegativeButton("Отмена", (d, w) -> {})
                        .setPositiveButton("Сбросить", (d, w) -> {
                            preferences.edit().clear().apply();
                            dialog.dismiss();
                            onApplied.run();
                            Toast.makeText(activity, "Настройки ExoPlayer сброшены", Toast.LENGTH_SHORT).show();
                        }).show();
            });
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                Map<String, Integer> values = new HashMap<>();
                String[][] ranges = {
                    {"minBufferSec", "1", "180"}, {"maxBufferSec", "1", "300"},
                    {"startBufferMs", "0", "30000"}, {"rebufferMs", "0", "30000"},
                    {"backBufferSec", "0", "60"}, {"connectMs", "1000", "60000"},
                    {"readMs", "1000", "60000"}, {"retries", "0", "10"}
                };
                for (String[] spec : ranges) {
                    try {
                        int value = Integer.parseInt(numbers.get(spec[0]).getText().toString().trim());
                        if (value < Integer.parseInt(spec[1]) || value > Integer.parseInt(spec[2])) throw new NumberFormatException();
                        values.put(spec[0], value);
                    } catch (NumberFormatException ex) {
                        numbers.get(spec[0]).setError("Допустимо: " + spec[1] + "–" + spec[2]);
                        numbers.get(spec[0]).requestFocus();
                        return;
                    }
                }
                if (flags.get("customBuffer").isChecked()) {
                    int minMs = values.get("minBufferSec") * 1000;
                    if (values.get("maxBufferSec") < values.get("minBufferSec") ||
                            values.get("startBufferMs") > minMs || values.get("rebufferMs") > minMs) {
                        Toast.makeText(activity, "Буфер: максимум ≥ минимум, старт и повтор ≤ минимум", Toast.LENGTH_LONG).show();
                        return;
                    }
                }
                SharedPreferences.Editor e = preferences.edit();
                for (Map.Entry<String, Integer> entry : values.entrySet()) e.putInt(entry.getKey(), entry.getValue());
                for (Map.Entry<String, CheckBox> entry : flags.entrySet()) e.putBoolean(entry.getKey(), entry.getValue().isChecked());
                for (Map.Entry<String, Spinner> entry : selections.entrySet()) e.putInt(entry.getKey(), entry.getValue().getSelectedItemPosition());
                for (Map.Entry<String, EditText> entry : strings.entrySet()) {
                    String s = entry.getValue().getText().toString().trim();
                    if (s.length() > 256 || s.contains("\r") || s.contains("\n")) {
                        entry.getValue().setError("Не более 256 символов; без переноса строк");
                        entry.getValue().requestFocus();
                        return;
                    }
                    e.putString(entry.getKey(), s);
                }
                e.apply();
                dialog.dismiss();
                onApplied.run();
                Toast.makeText(activity, "Настройки ExoPlayer применены", Toast.LENGTH_SHORT).show();
            });
        });
        dialog.show();
    }
}
