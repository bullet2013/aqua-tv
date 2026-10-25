package io.github.bullet2013.aquatv;

import android.app.Activity;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.util.Xml;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

import org.xmlpull.v1.XmlPullParser;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.DateFormat;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.GZIPInputStream;

/**
 * Native Android TV front-end for older Beelink firmware.
 * Does not depend on the installed Android System WebView, JavaScript or CSS.
 * Keeps the proven Media3 + FFmpeg audio pipeline unchanged.
 */
public final class TvActivity extends Activity {
    private static final String TAG = "AQUA-TV-TV";
    private static final String PLAYLIST = "https://bullet2013.github.io/aqua-tv/playlist.m3u";
    private static final String EPG = "https://bullet2013.github.io/aqua-tv/epg.xml.gz";
    private static final String ALLOWED_STREAM_HOST = "31.41.12.104";
    private static final Pattern ATTR = Pattern.compile("([\\w-]+)=\"([^\"]*)\"");
    private static final String ALL = "Все каналы";
    private static final int BLUE = Color.rgb(117, 210, 255);
    private static final int WHITE = Color.rgb(244, 250, 255);
    private static final int NAVY = Color.rgb(10, 37, 59);

    private static final class Channel {
        String name;
        String url;
        String category;
        String epgId;
        Channel(String name, String url, String category, String epgId) {
            this.name = name;
            this.url = url;
            this.category = category;
            this.epgId = epgId.toLowerCase(Locale.ROOT);
        }
    }

    private static final class Programme {
        String title;
        String description;
        long start;
        long end;
        Programme(String title, String description, long start, long end) {
            this.title = title;
            this.description = description;
            this.start = start;
            this.end = end;
        }
    }

    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final List<Channel> channels = new ArrayList<>();
    private final List<Channel> visible = new ArrayList<>();
    private final List<String> categoryNames = new ArrayList<>();
    private final Map<String, List<Programme>> programmes = new HashMap<>();

    private ExoSettings exoSettings;
    private ExoPlayer player;
    private PlayerView playerView;
    private FrameLayout root;
    private LinearLayout guide;
    private ListView categoryList;
    private ListView channelList;
    private ListView epgList;
    private TextView statusLabel;
    private TextView channelLabel;
    private TextView programmeLabel;
    private TextView epgStatus;
    private String category = ALL;
    private Channel selected;
    private boolean guideOpen = true;
    private boolean epgReady = false;

    private int dp(int n) {
        return Math.round(getResources().getDisplayMetrics().density * n);
    }

    private TextView label(String text, int size, int color) {
        TextView result = new TextView(this);
        result.setText(text);
        result.setTextColor(color);
        result.setTextSize(size);
        result.setGravity(Gravity.CENTER_VERTICAL);
        result.setPadding(dp(12), dp(7), dp(10), dp(7));
        return result;
    }

    private LinearLayout column(int color) {
        LinearLayout result = new LinearLayout(this);
        result.setOrientation(LinearLayout.VERTICAL);
        result.setBackgroundColor(color);
        return result;
    }

    private ArrayAdapter<String> adapter(List<String> data) {
        return new ArrayAdapter<String>(this, android.R.layout.simple_list_item_1, data) {
            @NonNull @Override public View getView(int position, View convertView,
                    @NonNull ViewGroup parent) {
                TextView item = (TextView) super.getView(position, convertView, parent);
                item.setTextColor(WHITE);
                item.setTextSize(17);
                item.setMinHeight(dp(48));
                item.setPadding(dp(13), dp(5), dp(12), dp(5));
                // Keep the native TV selector/focus drawable intact.
                return item;
            }
        };
    }

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);

        exoSettings = new ExoSettings(this);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        setContentView(root);

        playerView = new PlayerView(this);
        playerView.setUseController(false);
        playerView.setShutterBackgroundColor(Color.BLACK);
        root.addView(playerView, new FrameLayout.LayoutParams(-1, -1));

        player = buildPlayer();
        playerView.setPlayer(player);
        buildGuide();
        showGuide(true);
        statusLabel.setText("Подключаем плейлист…");

        network.execute(() -> {
            try {
                List<Channel> parsed = parsePlaylist(readText(PLAYLIST, 8 * 1024 * 1024));
                if (parsed.isEmpty()) throw new IOException("Плейлист пуст");
                main.post(() -> {
                    channels.addAll(parsed);
                    refreshCategories();
                    statusLabel.setText("Каналов: " + channels.size() + " · OK/ENTER — смотреть · MENU — ExoPlayer");
                    String remembered = getPreferences(MODE_PRIVATE).getString("lastUrl", "");
                    Channel first = channels.get(0);
                    for (Channel ch : channels) {
                        if (ch.url.equals(remembered)) { first = ch; break; }
                    }
                    playChannel(first);
                    focusCurrentChannel();
                });
                try {
                    Map<String, List<Programme>> guideData = parseEpg();
                    main.post(() -> {
                        programmes.putAll(guideData);
                        epgReady = true;
                        showEpg(focusedChannel());
                    });
                } catch (Exception epgError) {
                    Log.w(TAG, "EPG fetch/parse failed", epgError);
                    main.post(() -> {
                        epgReady = true;
                        epgStatus.setText("Телепрограмма пока недоступна: " + epgError.getMessage());
                    });
                }
            } catch (Exception e) {
                Log.e(TAG, "Playlist fetch/parse failed", e);
                main.post(() -> statusLabel.setText("Ошибка плейлиста: " + e.getMessage()));
            }
        });
    }

    private ExoPlayer buildPlayer() {
        ExoPlayer p = exoSettings.createPlayer();
        p.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                .build(), true);
        p.addListener(new Player.Listener() {
            @Override public void onPlayerError(@NonNull PlaybackException error) {
                Log.e(TAG, "Playback failed", error);
                statusLabel.setText("Ошибка ExoPlayer: " + error.getErrorCodeName());
                showGuide(true);
            }
        });
        return p;
    }

    private void buildGuide() {
        guide = new LinearLayout(this);
        guide.setOrientation(LinearLayout.HORIZONTAL);
        root.addView(guide, new FrameLayout.LayoutParams(-1, -1));

        LinearLayout categoriesPane = column(Color.rgb(8, 43, 69));
        guide.addView(categoriesPane, new LinearLayout.LayoutParams(dp(195), -1));
        TextView heading = label("AQUA TV", 25, BLUE);
        heading.setTypeface(null, android.graphics.Typeface.BOLD);
        categoriesPane.addView(heading);
        categoriesPane.addView(label("КАТЕГОРИИ", 13, BLUE));
        categoryList = new ListView(this);
        categoryList.setChoiceMode(ListView.CHOICE_MODE_SINGLE);
        categoryList.setItemsCanFocus(false);
        categoriesPane.addView(categoryList, new LinearLayout.LayoutParams(-1, 0, 1));
        categoryList.setAdapter(adapter(categoryNames));
        categoryList.setOnItemClickListener((parent, view, position, id) -> chooseCategory(position));
        categoryList.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View v, int position, long id) {
                if (categoryList.hasFocus()) chooseCategory(position);
            }
            @Override public void onNothingSelected(AdapterView<?> parent) {}
        });

        LinearLayout channelPane = column(Color.rgb(14, 62, 96));
        guide.addView(channelPane, new LinearLayout.LayoutParams(dp(320), -1));
        channelPane.addView(label("ТЕЛЕКАНАЛЫ", 17, WHITE));
        channelList = new ListView(this);
        channelList.setChoiceMode(ListView.CHOICE_MODE_SINGLE);
        channelList.setItemsCanFocus(false);
        channelPane.addView(channelList, new LinearLayout.LayoutParams(-1, 0, 1));
        channelList.setOnItemClickListener((parent, view, position, id) -> {
            if (position < 0 || position >= visible.size()) return;
            playChannel(visible.get(position));
            showGuide(false);
        });
        channelList.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View v, int position, long id) {
                if (position >= 0 && position < visible.size()) showEpg(visible.get(position));
            }
            @Override public void onNothingSelected(AdapterView<?> parent) {}
        });

        LinearLayout rightPane = new LinearLayout(this);
        rightPane.setOrientation(LinearLayout.VERTICAL);
        guide.addView(rightPane, new LinearLayout.LayoutParams(0, -1, 1));
        // No PlayerView resizing or detaching: the native video remains fullscreen
        // behind the transparent upper-right preview area. No TextureView blackout.
        TextView tvOverlay = label("● ПРЯМОЙ ЭФИР", 15, WHITE);
        tvOverlay.setGravity(Gravity.TOP | Gravity.RIGHT);
        tvOverlay.setBackgroundColor(Color.argb(90, 5, 23, 42));
        rightPane.addView(tvOverlay, new LinearLayout.LayoutParams(-1, 0, 1));

        LinearLayout epgPane = column(Color.argb(238, 8, 38, 65));
        rightPane.addView(epgPane, new LinearLayout.LayoutParams(-1, 0, 1));
        channelLabel = label("Телеканал", 21, WHITE);
        channelLabel.setTypeface(null, android.graphics.Typeface.BOLD);
        epgPane.addView(channelLabel);
        programmeLabel = label("Текущая передача появится здесь", 15, BLUE);
        epgPane.addView(programmeLabel);
        epgStatus = label("Загружаем EPG…", 13, WHITE);
        epgPane.addView(epgStatus);
        epgList = new ListView(this);
        epgPane.addView(epgList, new LinearLayout.LayoutParams(-1, 0, 1));
        epgList.setAdapter(adapter(new ArrayList<>()));
        epgList.setOnItemClickListener((parent, v, p, id) -> {
            Channel ch = focusedChannel();
            List<Programme> data = ch == null ? null : programmes.get(ch.epgId);
            if (data == null || data.isEmpty()) return;
            List<Programme> upcoming = upcoming(data);
            if (p < 0 || p >= upcoming.size()) return;
            Programme item = upcoming.get(p);
            new android.app.AlertDialog.Builder(this).setTitle(item.title)
                    .setMessage(item.description.isEmpty() ? "Описание отсутствует" : item.description)
                    .setPositiveButton("Закрыть", (d, w) -> {})
                    .show();
        });

        statusLabel = label("Загружаем…", 13, WHITE);
        statusLabel.setBackgroundColor(NAVY);
        channelPane.addView(statusLabel);
        categoryList.setOnKeyListener((v,key,event) ->
                horizontalKey(key,event,categoryList,channelList,null));
        channelList.setOnKeyListener((v,key,event) ->
                horizontalKey(key,event,channelList,epgList,categoryList));
        epgList.setOnKeyListener((v,key,event) ->
                horizontalKey(key,event,epgList,null,channelList));
    }

    private boolean horizontalKey(int key, KeyEvent event, View source, View right, View left) {
        if (event.getAction() != KeyEvent.ACTION_DOWN) return false;
        if (key == KeyEvent.KEYCODE_DPAD_RIGHT && right != null) {
            right.requestFocus();
            return true;
        }
        if (key == KeyEvent.KEYCODE_DPAD_LEFT && left != null) {
            left.requestFocus();
            return true;
        }
        return false;
    }

    private void refreshCategories() {
        Set<String> names = new LinkedHashSet<>();
        names.add(ALL);
        for (Channel ch : channels) names.add(ch.category);
        categoryNames.clear();
        categoryNames.addAll(names);
        categoryList.setAdapter(adapter(categoryNames));
        chooseCategory(0);
    }

    private void chooseCategory(int position) {
        if (position < 0 || position >= categoryNames.size()) return;
        category = categoryNames.get(position);
        visible.clear();
        for (Channel ch : channels) if (ALL.equals(category) || category.equals(ch.category)) visible.add(ch);
        List<String> names = new ArrayList<>();
        for (Channel ch : visible) names.add(ch.name);
        channelList.setAdapter(adapter(names));
        channelList.setSelection(0);
        if (!visible.isEmpty()) showEpg(visible.get(0));
    }

    private Channel focusedChannel() {
        int pos = channelList.getSelectedItemPosition();
        if (pos >= 0 && pos < visible.size()) return visible.get(pos);
        return selected;
    }

    private void focusCurrentChannel() {
        if (selected == null) return;
        if (!ALL.equals(category) && !selected.category.equals(category)) chooseCategory(0);
        for (int i = 0; i < visible.size(); i++) {
            if (visible.get(i).url.equals(selected.url)) {
                channelList.setSelection(i);
                showEpg(selected);
                return;
            }
        }
    }

    private void showGuide(boolean show) {
        guideOpen = show;
        guide.setVisibility(show ? View.VISIBLE : View.GONE);
        if (show) {
            focusCurrentChannel();
            channelList.requestFocus();
        }
    }

    private void playChannel(Channel ch) {
        if (ch == null) return;
        Uri uri = Uri.parse(ch.url);
        if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                || !ALLOWED_STREAM_HOST.equalsIgnoreCase(uri.getHost())) {
            statusLabel.setText("Недопустимый сервер потока: " + uri.getHost());
            return;
        }
        selected = ch;
        getPreferences(MODE_PRIVATE).edit().putString("lastUrl", ch.url).apply();
        player.setMediaItem(exoSettings.createMediaItem(uri));
        player.prepare();
        player.play();
        statusLabel.setText("Смотрим: " + ch.name + " · MENU — настройки плеера");
    }

    private void showEpg(Channel ch) {
        if (ch == null || channelLabel == null) return;
        channelLabel.setText(ch.name);
        List<Programme> schedule = programmes.get(ch.epgId);
        if (schedule == null || schedule.isEmpty()) {
            programmeLabel.setText("Передача не определена");
            epgStatus.setText(epgReady ? "Для канала нет программы" : "Загрузка телепрограммы…");
            epgList.setAdapter(adapter(new ArrayList<>()));
            return;
        }
        List<Programme> visiblePrograms = upcoming(schedule);
        long now = System.currentTimeMillis();
        String current = "Сейчас: нет данных";
        for (Programme entry : schedule) {
            if (entry.start <= now && entry.end > now) {
                current = "Сейчас: " + entry.title;
                break;
            }
        }
        programmeLabel.setText(current);
        epgStatus.setText("ПРОГРАММА ПЕРЕДАЧ");
        DateFormat hour = DateFormat.getTimeInstance(DateFormat.SHORT, new Locale("ru", "RU"));
        ArrayList<String> entries = new ArrayList<>();
        for (Programme p : visiblePrograms) {
            entries.add(hour.format(new Date(p.start)) + "   " + p.title);
        }
        epgList.setAdapter(adapter(entries));
    }

    private List<Programme> upcoming(List<Programme> schedule) {
        ArrayList<Programme> found = new ArrayList<>();
        long now = System.currentTimeMillis();
        for (Programme p : schedule) {
            if (p.end > now && p.start < now + 36 * 3600000L) found.add(p);
            if (found.size() >= 35) break;
        }
        return found;
    }

    @Override public boolean onKeyDown(int key, KeyEvent event) {
        if (key == KeyEvent.KEYCODE_MENU || key == KeyEvent.KEYCODE_SETTINGS) {
            exoSettings.showDialog(this, () -> {
                playerView.setPlayer(null);
                player.release();
                player = buildPlayer();
                playerView.setPlayer(player);
                if (selected != null) playChannel(selected);
            });
            return true;
        }
        if (!guideOpen) {
            if (key == KeyEvent.KEYCODE_DPAD_CENTER || key == KeyEvent.KEYCODE_ENTER
                    || key == KeyEvent.KEYCODE_BACK || key == KeyEvent.KEYCODE_DPAD_LEFT
                    || key == KeyEvent.KEYCODE_DPAD_RIGHT) {
                showGuide(true);
                return true;
            }
            if (key == KeyEvent.KEYCODE_DPAD_UP || key == KeyEvent.KEYCODE_DPAD_DOWN) {
                if (!channels.isEmpty()) {
                    int idx = 0;
                    for (int i = 0; i < channels.size(); i++)
                        if (selected != null && channels.get(i).url.equals(selected.url)) idx = i;
                    playChannel(channels.get((idx + (key == KeyEvent.KEYCODE_DPAD_UP ? -1 : 1)
                            + channels.size()) % channels.size()));
                }
                return true;
            }
        }
        if (guideOpen && key == KeyEvent.KEYCODE_BACK && selected != null) {
            showGuide(false);
            return true;
        }
        return super.onKeyDown(key, event);
    }

    @Override public void onBackPressed() {
        if (selected != null) showGuide(!guideOpen);
        else super.onBackPressed();
    }

    @Override protected void onPause() {
        super.onPause();
        if (player != null) player.pause();
    }

    @Override protected void onResume() {
        super.onResume();
        if (player != null && player.getMediaItemCount() > 0) player.play();
    }

    @Override protected void onDestroy() {
        network.shutdownNow();
        if (playerView != null) playerView.setPlayer(null);
        if (player != null) player.release();
        super.onDestroy();
    }

    private static String readText(String address, int maxBytes) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(18000);
        connection.setRequestProperty("User-Agent", "AQUA-TV-AndroidTV/1.0");
        try {
            if (connection.getResponseCode() != 200)
                throw new IOException("HTTP " + connection.getResponseCode());
            try (InputStream input = connection.getInputStream();
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] chunk = new byte[16384];
                int read;
                while ((read = input.read(chunk)) != -1) {
                    if (output.size() + read > maxBytes)
                        throw new IOException("Файл слишком большой");
                    output.write(chunk, 0, read);
                }
                return output.toString("UTF-8");
            }
        } finally { connection.disconnect(); }
    }

    private static String attribute(String line, String key) {
        Matcher m = ATTR.matcher(line);
        while (m.find()) if (key.equalsIgnoreCase(m.group(1))) return m.group(2);
        return "";
    }

    private static List<Channel> parsePlaylist(String source) {
        List<Channel> list = new ArrayList<>();
        String description = "";
        for (String rawLine : source.split("\\r?\\n")) {
            String line = rawLine.trim();
            if (line.startsWith("#EXTINF")) description = line;
            else if (!line.isEmpty() && !line.startsWith("#") && !description.isEmpty()) {
                int comma = description.lastIndexOf(',');
                String name = comma >= 0 ? description.substring(comma + 1).trim() : "";
                if (!name.isEmpty()) {
                    String group = attribute(description, "group-title");
                    if (group.isEmpty()) group = "Без категории";
                    list.add(new Channel(name, line, group, attribute(description, "tvg-id")));
                }
                description = "";
            }
        }
        return list;
    }

    private static long tvTime(String original, SimpleDateFormat clock) {
        if (original == null || original.length() < 14) return 0;
        try {
            String timestamp = original.substring(0, 14);
            String zone = original.length() >= 20 ? original.substring(15, 20) : "+0000";
            Date parsed = clock.parse(timestamp + " " + zone);
            return parsed == null ? 0 : parsed.getTime();
        } catch (Exception ignored) { return 0; }
    }

    private Map<String, List<Programme>> parseEpg() throws Exception {
        Set<String> wanted = new java.util.HashSet<>();
        // Playlist is parsed on this same serial worker; channels are synchronized with main.
        // Capture the IDs from the active playlist without touching UI state.
        // The cached IDs are filled by parsing the manifest again if UI has not drained yet.
        for (Channel ch : parsePlaylist(readText(PLAYLIST, 8 * 1024 * 1024)))
            if (!ch.epgId.isEmpty()) wanted.add(ch.epgId);

        HttpURLConnection connection = (HttpURLConnection) new URL(EPG).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        Map<String, List<Programme>> result = new HashMap<>();
        SimpleDateFormat clock = new SimpleDateFormat("yyyyMMddHHmmss Z", Locale.US);
        clock.setLenient(false);
        long now = System.currentTimeMillis();
        try {
            if (connection.getResponseCode() != 200)
                throw new IOException("EPG HTTP " + connection.getResponseCode());
            try (BufferedInputStream source = new BufferedInputStream(connection.getInputStream())) {
                source.mark(4);
                int a = source.read(), b = source.read();
                source.reset();
                InputStream decoded = (a == 0x1f && b == 0x8b) ? new GZIPInputStream(source) : source;
                XmlPullParser parser = Xml.newPullParser();
                parser.setInput(decoded, "UTF-8");
                for (int event = parser.getEventType(); event != XmlPullParser.END_DOCUMENT; event = parser.next()) {
                    if (event != XmlPullParser.START_TAG || !"programme".equals(parser.getName())) continue;
                    String id = parser.getAttributeValue(null, "channel");
                    if (id == null) continue;
                    id = id.toLowerCase(Locale.ROOT);
                    if (!wanted.contains(id)) continue;
                    long start = tvTime(parser.getAttributeValue(null, "start"), clock);
                    long stop = tvTime(parser.getAttributeValue(null, "stop"), clock);
                    if (stop <= now - 3600000L || start > now + 48 * 3600000L || start <= 0) continue;
                    String title = "", desc = "";
                    int depth = parser.getDepth();
                    while (parser.next() != XmlPullParser.END_DOCUMENT) {
                        if (parser.getEventType() == XmlPullParser.END_TAG &&
                                parser.getDepth() == depth && "programme".equals(parser.getName())) break;
                        if (parser.getEventType() == XmlPullParser.START_TAG) {
                            if ("title".equals(parser.getName())) title = parser.nextText();
                            else if ("desc".equals(parser.getName())) desc = parser.nextText();
                        }
                    }
                    if (!title.isEmpty()) {
                        List<Programme> channelPrograms = result.get(id);
                        if (channelPrograms == null) {
                            channelPrograms = new ArrayList<>();
                            result.put(id, channelPrograms);
                        }
                        channelPrograms.add(new Programme(title, desc, start, stop));
                    }
                }
            }
        } finally { connection.disconnect(); }
        for (List<Programme> listing : result.values()) {
            Collections.sort(listing, Comparator.comparingLong(p -> p.start));
        }
        return result;
    }
}
