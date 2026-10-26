package com.danielvu.quiethome;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.service.dreams.DreamService;
import android.text.TextUtils;
import android.text.format.DateFormat;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.Locale;

/** Two-column native screensaver. Uses only verified, encrypted cached calendar events. */
public final class VelaDreamService extends DreamService {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean beganOverVela;
    private boolean openedVelaOnWake;
    private FrameLayout root;
    private LinearLayout clockGroup, eventBlock, weatherGroup;
    private ImageView scenery;
    private TextView time, date, weatherNow, weatherWhere, weatherRain;
    private int dp(float n) { return Math.round(n * getResources().getDisplayMetrics().density); }
    private String currentProfile() {
        return getSharedPreferences("quiet-home", Context.MODE_PRIVATE)
            .getString("ui_active_profile_v2", "duong");
    }
    private String chooseWallpaper() {
        String[] images = {"mist-lake", "blue-coast", "amber-dunes", "lavender-bay"};
        try {
            SharedPreferences prefs = getSharedPreferences("quiet-home", Context.MODE_PRIVATE);
            JSONObject saved = new JSONObject(prefs.getString("ui_profile_data_v2", "{}"));
            JSONArray profiles = saved.optJSONArray("profiles");
            if (profiles != null) for (int i = 0; i < profiles.length(); i++) {
                JSONObject p = profiles.optJSONObject(i);
                if (p != null && currentProfile().equals(p.optString("id"))) {
                    int selected = Integer.parseInt(p.optString("scenery", "4"));
                    return "wallpapers/" + images[Math.floorMod(selected - 4, images.length)];
                }
            }
        } catch (Exception ignored) {}
        return "wallpapers/mist-lake";
    }
    private Bitmap loadScenery() {
        // Use the display's physical mode when available; launcher UI pixels can be 1080p on 4K sets.
        int target = getResources().getDisplayMetrics().widthPixels;
        try {
            android.view.WindowManager manager = (android.view.WindowManager) getSystemService(Context.WINDOW_SERVICE);
            android.view.Display display = manager == null ? null : manager.getDefaultDisplay();
            if (display != null && android.os.Build.VERSION.SDK_INT >= 23)
                target = Math.max(target, display.getMode().getPhysicalWidth());
        } catch (Exception ignored) {}
        String base = chooseWallpaper();
        boolean highRes = target > 1280;
        String asset = base + (highRes ? "-4k.webp" : ".webp");
        try {
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inJustDecodeBounds = true;
            try (InputStream bounds = getAssets().open(asset)) {
                BitmapFactory.decodeStream(bounds, null, options);
            }
            int sample = 1;
            while (options.outWidth / (sample * 2) >= target && options.outHeight / (sample * 2) >= 720)
                sample *= 2;
            options.inJustDecodeBounds = false;
            options.inSampleSize = sample;
            options.inPreferredConfig = Bitmap.Config.RGB_565; // Scenic photographs need no alpha; halve memory.
            try (InputStream data = getAssets().open(asset)) {
                return BitmapFactory.decodeStream(data, null, options);
            }
        } catch (Exception | OutOfMemoryError ignored) {
            return null; // Keep the opaque, safe solid background if the asset cannot be decoded.
        }
    }
    private TextView label(String value, int size, int color) {
        TextView view = new TextView(this);
        view.setText(value); view.setTextSize(size); view.setTextColor(color);
        view.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        view.setSingleLine(true); view.setEllipsize(TextUtils.TruncateAt.END);
        return view;
    }
    private void showWeather(String text) {
        if (weatherGroup == null || weatherNow == null) return;
        try {
            JSONObject s = new JSONObject(text);
            long age = System.currentTimeMillis() - s.optLong("updatedAt", 0);
            double temp = s.optDouble("temperature", Double.NaN);
            if (age < 0 || age > 90 * 60_000L || !Double.isFinite(temp)) {
                weatherGroup.setVisibility(View.GONE);return;
            }
            String unit = "C".equals(s.optString("unit")) ? "C" : "F";
            String condition = s.optString("condition", "");
            weatherNow.setText(Math.round(temp) + "°" + unit + "  ·  " + condition);
            String city = s.optString("city", ""),country = s.optString("country", "");
            String area = "US".equals(country) ? s.optString("region", "") : country;
            weatherWhere.setText(city + (!city.isEmpty() && !area.isEmpty() ? ", " : "") + area);
            double precip = s.optDouble("precipitation", Double.NaN);
            String u = "in".equals(s.optString("precipUnit")) ? "in" : "mm";
            String current = Double.isFinite(precip) ? (precip > 0 ? "Precip now " + String.format(Locale.US,u.equals("in")?"%.2f":"%.1f",precip) + " " + u : "Dry now") : "";
            Object chance = s.opt("rainChance");
            if (chance instanceof Number) current += (current.isEmpty()?"":"  ·  ") + ((Number)chance).intValue() + "% next hour";
            weatherRain.setText(current);
            weatherGroup.setVisibility(View.VISIBLE);
        } catch (Exception ignored) { weatherGroup.setVisibility(View.GONE); }
    }
    /** Current events stay until their end; upcoming window is two hours. */
    private void refreshEvents() {
        if (eventBlock == null) return;
        eventBlock.removeAllViews();
        JSONArray data = VelaCalendarController.cachedEventsForDream(this, currentProfile());
        long now = System.currentTimeMillis();
        ArrayList<JSONObject> events = new ArrayList<>();
        for (int i = 0; i < data.length(); i++) {
            JSONObject e = data.optJSONObject(i);
            if (e == null) continue;
            long start = e.optLong("start"), end = e.optLong("end");
            if (start <= 0 || end <= now || start > now + 2 * 3600000L) continue;
            events.add(e);
        }
        Collections.sort(events, (a, b) -> {
            boolean aAll = a.optBoolean("allDay"), bAll = b.optBoolean("allDay");
            if (aAll != bAll) return aAll ? 1 : -1;
            boolean aNow = a.optLong("start") <= now, bNow = b.optLong("start") <= now;
            if (aNow != bNow) return aNow ? -1 : 1;
            return Long.compare(a.optLong("start"), b.optLong("start"));
        });
        eventBlock.setVisibility(events.isEmpty() ? View.GONE : View.VISIBLE);
        if (events.isEmpty()) return;
        TextView heading = label("NOW / NEXT", 11, Color.rgb(173, 183, 197));
        heading.setLetterSpacing(.17f);
        LinearLayout.LayoutParams headParams = new LinearLayout.LayoutParams(-1, -2);
        headParams.bottomMargin = dp(12);
        eventBlock.addView(heading, headParams);
        for (int i = 0; i < Math.min(3, events.size()); i++) {
            JSONObject e = events.get(i);
            boolean allDay = e.optBoolean("allDay");
            boolean ongoing = !allDay && e.optLong("start") <= now;
            Date begins = new Date(e.optLong("start"));
            String day = new SimpleDateFormat("EEE M/d", Locale.US).format(begins);
            String when = ("play".equals(e.optString("kind"))?"PLAY · ":
                "watch".equals(e.optString("kind"))?"WATCH · ":"") +
                (ongoing?"NOW · ":"") + day + " · " +
                (allDay?"ALL DAY":DateFormat.getTimeFormat(this).format(begins));
            String title = e.optString("title", "Event").replace('\n', ' ').trim();
            if (title.isEmpty()) title = "Event";
            LinearLayout row = new LinearLayout(this);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setPadding(0, dp(9), 0, dp(9));
            // Calm sage-white for both statuses, no bright gold or green boxes.
            TextView status = label(when, 11, ongoing ? Color.rgb(242, 196, 126) : Color.rgb(173, 183, 197));
            status.setTypeface(null, android.graphics.Typeface.BOLD);
            status.setLetterSpacing(.025f);
            row.addView(status, new LinearLayout.LayoutParams(dp(214), -2));
            TextView summary = label(title, 16, ongoing ? Color.rgb(244, 246, 250) : Color.rgb(214, 221, 231));
            row.addView(summary, new LinearLayout.LayoutParams(0, -2, 1));
            eventBlock.addView(row, new LinearLayout.LayoutParams(-1, -2));
        }
    }
    /** Anchored at lower corners, with subtle coordinated movement every five minutes. */
    private void positionContent() {
        if (root == null || clockGroup == null || eventBlock == null) return;
        root.post(() -> {
            if (root == null || clockGroup == null || eventBlock == null) return;
            int w = root.getWidth(), h = root.getHeight();
            if (w <= 0 || h <= 0) return;
            int horizontal = Math.max(dp(36), Math.round(w * .065f));
            int bottom = Math.max(dp(45), Math.round(h * .12f));
            FrameLayout.LayoutParams left = new FrameLayout.LayoutParams(-2, -2, Gravity.START | Gravity.BOTTOM);
            left.leftMargin = horizontal; left.bottomMargin = bottom;
            clockGroup.setLayoutParams(left);
            FrameLayout.LayoutParams right = new FrameLayout.LayoutParams(
                Math.min(Math.round(w * .41f), dp(650)), -2, Gravity.END | Gravity.BOTTOM);
            right.rightMargin = horizontal; right.bottomMargin = bottom;
            eventBlock.setLayoutParams(right);
            if (weatherGroup != null) {
                FrameLayout.LayoutParams weather = new FrameLayout.LayoutParams(
                    Math.min(Math.round(w * .35f), dp(550)), -2, Gravity.END | Gravity.TOP);
                weather.rightMargin = horizontal;weather.topMargin = Math.max(dp(35),Math.round(h*.18f));
                weatherGroup.setLayoutParams(weather);
            }
            int step = (int) ((System.currentTimeMillis() / 300000L) % 4);
            float[] dx = {0f, 1f, 0f, -1f}, dy = {0f, 0f, -1f, 1f};
            float x = dp(18) * dx[step], y = dp(14) * dy[step];
            clockGroup.setTranslationX(x); clockGroup.setTranslationY(y);
            eventBlock.setTranslationX(x); eventBlock.setTranslationY(y);
            if (weatherGroup != null) {weatherGroup.setTranslationX(-x);weatherGroup.setTranslationY(-y);}
        });
    }
    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            if (root == null || time == null) return;
            Date now = new Date();
            time.setText(DateFormat.getTimeFormat(VelaDreamService.this).format(now));
            date.setText(new SimpleDateFormat("EEEE, MMMM d", Locale.getDefault()).format(now));
            refreshEvents(); positionContent();
            // Native dream refresh is independent of Home WebView timers.
            VelaWeatherRepository.refresh(VelaDreamService.this,
                json -> handler.post(() -> showWeather(json)));
            handler.postDelayed(this, 60000L - (System.currentTimeMillis() % 60000L) + 60L);
        }
    };
    @Override public void onAttachedToWindow() {
        super.onAttachedToWindow();
        setInteractive(false); setFullscreen(true); setScreenBright(true);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(13, 18, 27));
        scenery = new ImageView(this);
        scenery.setScaleType(ImageView.ScaleType.CENTER_CROP);
        scenery.setAlpha(.58f);
        Bitmap bitmap = loadScenery();
        if (bitmap != null) scenery.setImageBitmap(bitmap);
        root.addView(scenery, new FrameLayout.LayoutParams(-1, -1));
        FrameLayout veil = new FrameLayout(this);
        veil.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            new int[] {Color.argb(20, 8, 19, 23), Color.argb(155, 7, 17, 21)}));
        root.addView(veil, new FrameLayout.LayoutParams(-1, -1));
        clockGroup = new LinearLayout(this);
        clockGroup.setOrientation(LinearLayout.VERTICAL);
        clockGroup.setGravity(Gravity.START);
        time = label(DateFormat.getTimeFormat(this).format(new Date()), 78, Color.rgb(244, 246, 250));
        time.setTypeface(android.graphics.Typeface.create("serif", android.graphics.Typeface.NORMAL));
        time.setLetterSpacing(-.055f);
        date = label(new SimpleDateFormat("EEEE, MMMM d", Locale.getDefault()).format(new Date()),
            18, Color.rgb(173, 183, 197));
        LinearLayout.LayoutParams dateParams = new LinearLayout.LayoutParams(-2, -2);
        dateParams.topMargin = dp(7);
        clockGroup.addView(time, new LinearLayout.LayoutParams(-2, -2));
        clockGroup.addView(date, dateParams);
        root.addView(clockGroup, new FrameLayout.LayoutParams(-2, -2, Gravity.START | Gravity.BOTTOM));
        eventBlock = new LinearLayout(this);
        eventBlock.setGravity(Gravity.START);
        eventBlock.setOrientation(LinearLayout.VERTICAL);
        eventBlock.setPadding(dp(22), dp(18), dp(22), dp(16));
        GradientDrawable glass = new GradientDrawable();
        glass.setColor(Color.argb(150, 24, 33, 46));
        glass.setCornerRadius(dp(18));
        glass.setStroke(dp(1), Color.argb(24, 244, 246, 250));
        eventBlock.setBackground(glass);
        root.addView(eventBlock, new FrameLayout.LayoutParams(-2, -2, Gravity.END | Gravity.BOTTOM));
        weatherGroup = new LinearLayout(this);
        weatherGroup.setGravity(Gravity.START);
        weatherGroup.setOrientation(LinearLayout.VERTICAL);
        weatherGroup.setPadding(dp(20), dp(15), dp(20), dp(15));
        GradientDrawable weatherGlass = new GradientDrawable();
        weatherGlass.setColor(Color.argb(120, 24, 33, 46));
        weatherGlass.setCornerRadius(dp(17));
        weatherGlass.setStroke(dp(1),Color.argb(22, 244, 246, 250));
        weatherGroup.setBackground(weatherGlass);
        TextView weatherHeader = label("LOCAL WEATHER  ·  APPROX.", 11, Color.rgb(173, 183, 197));
        weatherHeader.setLetterSpacing(.16f);
        weatherGroup.addView(weatherHeader, new LinearLayout.LayoutParams(-1, -2));
        weatherNow = label("", 30, Color.rgb(245, 250, 246));
        LinearLayout.LayoutParams currentParams = new LinearLayout.LayoutParams(-1,-2);
        currentParams.topMargin = dp(8);
        weatherGroup.addView(weatherNow,currentParams);
        weatherWhere = label("", 14, Color.rgb(217, 231, 221));
        LinearLayout.LayoutParams placeParams = new LinearLayout.LayoutParams(-1,-2);
        placeParams.topMargin=dp(4);
        weatherGroup.addView(weatherWhere,placeParams);
        weatherRain = label("", 13, Color.rgb(188, 207, 197));
        LinearLayout.LayoutParams rainParams = new LinearLayout.LayoutParams(-1,-2);
        rainParams.topMargin=dp(6);
        weatherGroup.addView(weatherRain,rainParams);
        weatherGroup.setVisibility(View.GONE);
        root.addView(weatherGroup,new FrameLayout.LayoutParams(-2,-2,Gravity.END | Gravity.TOP));
        setContentView(root); refreshEvents(); positionContent();
        showWeather(VelaWeatherRepository.cached(this));
    }
    @Override public void onDreamingStarted() {
        super.onDreamingStarted();
        beganOverVela = MainActivity.wasHomeUnderDream(SystemClock.elapsedRealtime());
        openedVelaOnWake = false;
        handler.removeCallbacks(ticker);
        ticker.run();
    }
    @Override public void onWakeUp() {
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        boolean interactive = power != null && power.isInteractive();
        if (VelaDreamReturnPolicy.shouldOpenVela(beganOverVela, interactive, openedVelaOnWake)) {
            openedVelaOnWake = true;
            // Launch before the Dream window is dismissed. Android can reject background
            // launches after finish(), revealing Sony's stock Home underneath instead.
            Intent home = new Intent(this, MainActivity.class);
            home.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NO_ANIMATION);
            try { startActivity(home); }
            catch (RuntimeException exception) {
                Log.w("VelaDream", "Sony did not allow return to Vela after dream wake", exception);
            }
        }
        super.onWakeUp();
    }
    @Override public void onDreamingStopped() { handler.removeCallbacks(ticker); super.onDreamingStopped(); }
    @Override public void onDetachedFromWindow() {
        handler.removeCallbacks(ticker);
        if (scenery != null) scenery.setImageDrawable(null);
        scenery = null; clockGroup = null; root = null; time = null; date = null;
        eventBlock = null; weatherGroup = null;weatherNow = null;weatherWhere = null;weatherRain = null;
        super.onDetachedFromWindow();
    }
}
