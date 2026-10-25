package com.danielvu.quiethome;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.service.dreams.DreamService;
import android.text.TextUtils;
import android.text.format.DateFormat;
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
    private FrameLayout root;
    private LinearLayout clockGroup, eventBlock;
    private ImageView scenery;
    private TextView time, date;
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
        TextView heading = label("ON YOUR CALENDAR", 11, Color.rgb(198, 214, 208));
        heading.setLetterSpacing(.17f);
        LinearLayout.LayoutParams headParams = new LinearLayout.LayoutParams(-1, -2);
        headParams.bottomMargin = dp(12);
        eventBlock.addView(heading, headParams);
        for (int i = 0; i < Math.min(3, events.size()); i++) {
            JSONObject e = events.get(i);
            boolean allDay = e.optBoolean("allDay");
            boolean ongoing = !allDay && e.optLong("start") <= now;
            long until = e.optLong("start") - now;
            String when = allDay ? "ALL DAY" : ongoing ? "NOW" : until <= 3600000L
                ? "IN " + Math.max(1, (until + 59999) / 60000) + " MIN"
                : DateFormat.getTimeFormat(this).format(new Date(e.optLong("start")));
            String title = e.optString("title", "Event").replace('\n', ' ').trim();
            if (title.isEmpty()) title = "Event";
            LinearLayout row = new LinearLayout(this);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setPadding(0, dp(9), 0, dp(9));
            // Calm sage-white for both statuses, no bright gold or green boxes.
            TextView status = label(when, 12, ongoing ? Color.rgb(220, 237, 224) : Color.rgb(182, 207, 195));
            status.setTypeface(null, android.graphics.Typeface.BOLD);
            status.setLetterSpacing(.025f);
            row.addView(status, new LinearLayout.LayoutParams(dp(110), -2));
            TextView summary = label(title, 16, ongoing ? Color.rgb(242, 249, 244) : Color.rgb(222, 232, 225));
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
            int step = (int) ((System.currentTimeMillis() / 300000L) % 4);
            float[] dx = {0f, 1f, 0f, -1f}, dy = {0f, 0f, -1f, 1f};
            float x = dp(9) * dx[step], y = dp(7) * dy[step];
            clockGroup.setTranslationX(x); clockGroup.setTranslationY(y);
            eventBlock.setTranslationX(x); eventBlock.setTranslationY(y);
        });
    }
    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            if (root == null || time == null) return;
            Date now = new Date();
            time.setText(DateFormat.getTimeFormat(VelaDreamService.this).format(now));
            date.setText(new SimpleDateFormat("EEEE, MMMM d", Locale.getDefault()).format(now));
            refreshEvents(); positionContent();
            handler.postDelayed(this, 60000L - (System.currentTimeMillis() % 60000L) + 60L);
        }
    };
    @Override public void onAttachedToWindow() {
        super.onAttachedToWindow();
        setInteractive(false); setFullscreen(true); setScreenBright(true);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(17, 34, 38));
        scenery = new ImageView(this);
        scenery.setScaleType(ImageView.ScaleType.CENTER_CROP);
        scenery.setAlpha(.72f);
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
        time = label(DateFormat.getTimeFormat(this).format(new Date()), 78, Color.rgb(245, 250, 246));
        time.setTypeface(android.graphics.Typeface.create("serif", android.graphics.Typeface.NORMAL));
        time.setLetterSpacing(-.055f);
        date = label(new SimpleDateFormat("EEEE, MMMM d", Locale.getDefault()).format(new Date()),
            18, Color.rgb(211, 227, 220));
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
        glass.setColor(Color.argb(64, 12, 29, 32));
        glass.setCornerRadius(dp(18));
        glass.setStroke(dp(1), Color.argb(41, 219, 236, 223));
        eventBlock.setBackground(glass);
        root.addView(eventBlock, new FrameLayout.LayoutParams(-2, -2, Gravity.END | Gravity.BOTTOM));
        setContentView(root); refreshEvents(); positionContent();
    }
    @Override public void onDreamingStarted() { super.onDreamingStarted(); handler.removeCallbacks(ticker); ticker.run(); }
    @Override public void onDreamingStopped() { handler.removeCallbacks(ticker); super.onDreamingStopped(); }
    @Override public void onDetachedFromWindow() {
        handler.removeCallbacks(ticker);
        if (scenery != null) scenery.setImageDrawable(null);
        scenery = null; clockGroup = null; root = null; time = null; date = null; eventBlock = null;
        super.onDetachedFromWindow();
    }
}
