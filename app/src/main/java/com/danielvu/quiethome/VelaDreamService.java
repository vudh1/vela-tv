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
import android.text.format.DateFormat;
import android.view.Gravity;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * Native, lightweight Vela screensaver. No WebView, network access, or redraw loop.
 * Uses the active profile's bundled scenic wallpaper and repositions the clock
 * periodically; Sony Ambient mode still controls whether third-party dreams run.
 */
public final class VelaDreamService extends DreamService {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private FrameLayout root;
    private LinearLayout clockGroup;
    private ImageView scenery;
    private TextView time;
    private TextView date;

    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            if (root == null || time == null || clockGroup == null) return;
            Date now = new Date();
            time.setText(DateFormat.getTimeFormat(VelaDreamService.this).format(now));
            date.setText(new SimpleDateFormat("EEEE, MMMM d", Locale.getDefault()).format(now));
            // Offset the entire group, not two unrelated TextViews. Clamp to screen bounds.
            root.post(() -> {
                if (root == null || clockGroup == null) return;
                int availableX = Math.max(0, (root.getWidth() - clockGroup.getWidth()) / 2 - 35);
                int availableY = Math.max(0, (root.getHeight() - clockGroup.getHeight()) / 2 - 35);
                int step = (int)((System.currentTimeMillis() / 300000L) % 4);
                float[] xs = { -0.55f, 0.58f, 0.32f, -0.36f };
                float[] ys = { -0.30f, -0.10f, 0.42f, 0.33f };
                clockGroup.setTranslationX(availableX * xs[step]);
                clockGroup.setTranslationY(availableY * ys[step]);
            });
            handler.postDelayed(this, 60000L - (System.currentTimeMillis() % 60000L) + 60L);
        }
    };

    private String chooseWallpaper() {
        // Personalize data is saved per profile, and never leaves the device.
        String[] images = { "mist-lake", "blue-coast", "amber-dunes", "lavender-bay" };
        try {
            SharedPreferences prefs = getSharedPreferences("quiet-home", Context.MODE_PRIVATE);
            String active = prefs.getString("ui_active_profile_v2", "duong");
            JSONObject saved = new JSONObject(prefs.getString("ui_profile_data_v2", "{}"));
            JSONArray profiles = saved.optJSONArray("profiles");
            if (profiles != null) {
                for (int i = 0; i < profiles.length(); i++) {
                    JSONObject p = profiles.optJSONObject(i);
                    if (p != null && active.equals(p.optString("id"))) {
                        int selected = Integer.parseInt(p.optString("scenery", "4"));
                        // SVG wallpapers have no native decoder; use an analogous bundled photograph.
                        return "wallpapers/" + images[Math.floorMod(selected - 4, images.length)] + ".webp";
                    }
                }
            }
        } catch (Exception ignored) { }
        return "wallpapers/mist-lake.webp";
    }

    @Override public void onAttachedToWindow() {
        super.onAttachedToWindow();
        setInteractive(false);
        setFullscreen(true);
        // The previous false setting allowed Sony's power policy to dim the dream to black.
        // Keep the panel awake; dim the IMAGE pixels rather than the hardware backlight.
        setScreenBright(true);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(19, 38, 43));

        scenery = new ImageView(this);
        scenery.setScaleType(ImageView.ScaleType.CENTER_CROP);
        scenery.setAlpha(0.57f);
        try (InputStream in = getAssets().open(chooseWallpaper())) {
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inSampleSize = 2; // small, one-time decode; never on a periodic tick
            Bitmap bitmap = BitmapFactory.decodeStream(in, null, options);
            if (bitmap != null) scenery.setImageBitmap(bitmap);
        } catch (Exception ignored) { /* solid dark teal is the safe fallback */ }
        root.addView(scenery, new FrameLayout.LayoutParams(-1, -1));

        FrameLayout veil = new FrameLayout(this);
        veil.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            new int[] { Color.argb(90, 5, 20, 26), Color.argb(150, 5, 15, 20) }));
        root.addView(veil, new FrameLayout.LayoutParams(-1, -1));

        clockGroup = new LinearLayout(this);
        clockGroup.setOrientation(LinearLayout.VERTICAL);
        clockGroup.setGravity(Gravity.CENTER);
        time = new TextView(this);
        time.setTextSize(68f);
        time.setTextColor(Color.rgb(236, 246, 240));
        time.setGravity(Gravity.CENTER);
        date = new TextView(this);
        date.setTextSize(20f);
        date.setTextColor(Color.rgb(201, 222, 217));
        date.setGravity(Gravity.CENTER);
        clockGroup.addView(time, new LinearLayout.LayoutParams(-2, -2));
        clockGroup.addView(date, new LinearLayout.LayoutParams(-2, -2));
        root.addView(clockGroup, new FrameLayout.LayoutParams(-2, -2, Gravity.CENTER));
        setContentView(root);
        // Show a usable clock immediately, even on first attach / system preview.
        time.setText(DateFormat.getTimeFormat(this).format(new Date()));
        date.setText(new SimpleDateFormat("EEEE, MMMM d", Locale.getDefault()).format(new Date()));
    }

    @Override public void onDreamingStarted() {
        super.onDreamingStarted();
        handler.removeCallbacks(ticker);
        ticker.run();
    }

    @Override public void onDreamingStopped() {
        handler.removeCallbacks(ticker);
        super.onDreamingStopped();
    }

    @Override public void onDetachedFromWindow() {
        handler.removeCallbacks(ticker);
        if (scenery != null) scenery.setImageDrawable(null);
        scenery = null;
        clockGroup = null;
        root = null;
        time = null;
        date = null;
        super.onDetachedFromWindow();
    }
}
